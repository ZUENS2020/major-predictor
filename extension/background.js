// Background service worker for Major Predictor extension

// Listen for messages from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'fetchHLTVData') {
    fetchHLTVData(request.teamName)
      .then(data => sendResponse({ success: true, data }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // Keep channel open for async response
  }
  
  if (request.action === 'getPrediction') {
    getPrediction(request.matchData)
      .then(prediction => sendResponse({ success: true, prediction }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === 'getSettings') {
    chrome.storage.sync.get([
      'openRouterApiKey',
      'tavilyApiKey',
      'aiModel',
      'autoPredict',
      'showConfidence',
      'includeHltv'
    ]).then(settings => sendResponse({ success: true, settings }));
    return true;
  }
});

// Fetch team data from HLTV
async function fetchHLTVData(teamName) {
  try {
    // Search for the team on HLTV
    const searchUrl = `https://www.hltv.org/search?term=${encodeURIComponent(teamName)}`;
    
    // Note: Due to CORS restrictions, we use a simulated response for now
    // In production, this would need a proper backend proxy or HLTV API access
    
    // For demonstration, return structured data that would come from HLTV
    const teamData = {
      name: teamName,
      ranking: null,
      recentMatches: [],
      mapStats: {},
      recentForm: 'Unknown',
      rosterChanges: [],
      lastUpdated: new Date().toISOString()
    };

    // Note: Direct HLTV fetch is not possible due to CORS restrictions
    // The AI model will use its trained knowledge of teams instead
    // For production use, consider implementing a backend proxy service
    teamData.dataAvailable = false;

    return teamData;
  } catch (error) {
    console.error('Error fetching HLTV data:', error);
    throw error;
  }
}

// Get prediction from OpenRouter API
async function getPrediction(matchData) {
  const settings = await chrome.storage.sync.get(['openRouterApiKey', 'tavilyApiKey', 'aiModel', 'showConfidence', 'includeHltv']);
  
  if (!settings.openRouterApiKey) {
    throw new Error('OpenRouter API key not configured. Please set it in the extension settings.');
  }

  const model = settings.aiModel || 'anthropic/claude-3.5-sonnet';
  
  // Collect data from multiple sources with weighting
  let hltvData = null;
  let searchContext = '';
  
  // Priority 1: HLTV API (highest weight) - only if enabled
  if (settings.includeHltv !== false) {
    try {
      console.log('Fetching HLTV API data for:', matchData.team1, 'vs', matchData.team2);
      hltvData = await fetchHLTVApiData(matchData.team1, matchData.team2);
      console.log('HLTV API data:', hltvData);
    } catch (e) {
      console.error('HLTV API failed:', e);
    }
  }

  // Priority 2: Tavily search for additional context
  if (settings.tavilyApiKey) {
    try {
      const query = `site:hltv.org ${matchData.team1} vs ${matchData.team2} match history head to head 2024 2025`;
      const searchResults = await searchTavily(query, settings.tavilyApiKey);
      if (searchResults) {
        searchContext = formatSearchResults(searchResults);
      }
    } catch (e) {
      console.error('Search failed:', e);
    }
  }

  // Build the prompt with weighted data
  const prompt = buildPredictionPrompt(matchData, settings, hltvData, searchContext);

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${settings.openRouterApiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://majors.im',
        'X-Title': 'Major Predictor'
      },
      body: JSON.stringify({
        model: model,
        messages: [
          {
            role: 'system',
            content: `You are an expert CS2 esports analyst. Your predictions are based on data with the following priority weights:
1. HLTV official data (highest priority - 60% weight): Team rankings, recent match results, head-to-head records
2. Recent search results (medium priority - 30% weight): News, roster changes, recent form
3. Your knowledge (lowest priority - 10% weight): Historical context

Always base your prediction primarily on the HLTV data provided. Respond with valid JSON only.`
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: 1500,
        temperature: 0.3
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'Failed to get prediction from AI');
    }

    const result = await response.json();
    const content = result.choices[0]?.message?.content;
    
    if (!content) {
      throw new Error('Empty response from AI');
    }

    // Parse the AI response
    return parseAIPrediction(content, matchData);
  } catch (error) {
    console.error('Prediction error:', error);
    throw error;
  }
}

// Fetch data from HLTV API
async function fetchHLTVApiData(team1, team2) {
  const baseUrl = 'https://hltv-api.vercel.app/api';
  
  try {
    // Fetch top teams ranking
    const teamsRes = await fetch(`${baseUrl}/teams`);
    const teamsData = teamsRes.ok ? await teamsRes.json() : [];
    
    // Fetch recent results
    const resultsRes = await fetch(`${baseUrl}/results`);
    const resultsData = resultsRes.ok ? await resultsRes.json() : [];
    
    // Find team rankings
    const team1Rank = teamsData.find(t => 
      t.name?.toLowerCase().includes(team1.toLowerCase()) ||
      team1.toLowerCase().includes(t.name?.toLowerCase())
    );
    const team2Rank = teamsData.find(t => 
      t.name?.toLowerCase().includes(team2.toLowerCase()) ||
      team2.toLowerCase().includes(t.name?.toLowerCase())
    );
    
    // Find recent matches involving these teams
    const team1Matches = resultsData.filter(m => 
      m.team1?.name?.toLowerCase().includes(team1.toLowerCase()) ||
      m.team2?.name?.toLowerCase().includes(team1.toLowerCase()) ||
      team1.toLowerCase().includes(m.team1?.name?.toLowerCase() || '') ||
      team1.toLowerCase().includes(m.team2?.name?.toLowerCase() || '')
    ).slice(0, 5);
    
    const team2Matches = resultsData.filter(m => 
      m.team1?.name?.toLowerCase().includes(team2.toLowerCase()) ||
      m.team2?.name?.toLowerCase().includes(team2.toLowerCase()) ||
      team2.toLowerCase().includes(m.team1?.name?.toLowerCase() || '') ||
      team2.toLowerCase().includes(m.team2?.name?.toLowerCase() || '')
    ).slice(0, 5);
    
    // Find head-to-head matches
    const h2hMatches = resultsData.filter(m => {
      const teams = [m.team1?.name?.toLowerCase(), m.team2?.name?.toLowerCase()];
      const hasTeam1 = teams.some(t => t?.includes(team1.toLowerCase()) || team1.toLowerCase().includes(t || ''));
      const hasTeam2 = teams.some(t => t?.includes(team2.toLowerCase()) || team2.toLowerCase().includes(t || ''));
      return hasTeam1 && hasTeam2;
    }).slice(0, 5);
    
    return {
      team1: {
        name: team1,
        ranking: team1Rank?.ranking || 'Unranked',
        points: team1Rank?.points || 0,
        recentMatches: team1Matches.map(m => ({
          opponent: m.team1?.name === team1 ? m.team2?.name : m.team1?.name,
          result: m.matchResult,
          event: m.event?.name
        }))
      },
      team2: {
        name: team2,
        ranking: team2Rank?.ranking || 'Unranked',
        points: team2Rank?.points || 0,
        recentMatches: team2Matches.map(m => ({
          opponent: m.team1?.name === team2 ? m.team2?.name : m.team1?.name,
          result: m.matchResult,
          event: m.event?.name
        }))
      },
      headToHead: h2hMatches.map(m => ({
        team1: m.team1?.name,
        team2: m.team2?.name,
        result: m.matchResult,
        event: m.event?.name
      })),
      dataSource: 'HLTV API',
      fetchedAt: new Date().toISOString()
    };
  } catch (error) {
    console.error('Error fetching HLTV API:', error);
    return null;
  }
}

async function searchTavily(query, apiKey) {
  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      api_key: apiKey,
      query: query,
      search_depth: "advanced",
      include_domains: ["hltv.org"],
      include_answer: true,
      max_results: 5
    })
  });
  
  if (!response.ok) return null;
  return await response.json();
}

function formatSearchResults(data) {
  if (!data || !data.results) return '';
  let text = "=== Additional Search Results (from HLTV) ===\n";
  if (data.answer) {
    text += `Summary: ${data.answer}\n\n`;
  }
  text += data.results.map(r => `• ${r.title}: ${r.content?.substring(0, 200)}`).join('\n');
  return text;
}

// Build the prompt for the AI model
function buildPredictionPrompt(matchData, settings, hltvData, searchContext) {
  let prompt = `Analyze this CS2 match and provide a prediction:

=== MATCH INFO ===
Team 1: ${matchData.team1}
Team 2: ${matchData.team2}
Tournament: ${matchData.tournament || 'Major Championship'}
Match Type: ${matchData.matchType || 'Best of 3'}

`;

  // Add HLTV data (highest weight)
  if (hltvData) {
    prompt += `=== HLTV DATA (PRIMARY SOURCE - 60% weight) ===
${matchData.team1}:
  - World Ranking: #${hltvData.team1.ranking}
  - Ranking Points: ${hltvData.team1.points}
  - Recent Matches: ${hltvData.team1.recentMatches.length > 0 
    ? hltvData.team1.recentMatches.map(m => `vs ${m.opponent}: ${m.result}`).join(', ')
    : 'No recent data'}

${matchData.team2}:
  - World Ranking: #${hltvData.team2.ranking}
  - Ranking Points: ${hltvData.team2.points}
  - Recent Matches: ${hltvData.team2.recentMatches.length > 0 
    ? hltvData.team2.recentMatches.map(m => `vs ${m.opponent}: ${m.result}`).join(', ')
    : 'No recent data'}

Head-to-Head History:
${hltvData.headToHead.length > 0 
  ? hltvData.headToHead.map(m => `${m.team1} vs ${m.team2}: ${m.result} (${m.event})`).join('\n')
  : 'No recent head-to-head data'}

`;
  } else {
    prompt += `=== HLTV DATA ===
(Unable to fetch - use your knowledge as fallback)

`;
  }

  // Add search context (medium weight)
  if (searchContext) {
    prompt += `
${searchContext}

`;
  }

  prompt += `=== INSTRUCTIONS ===
Based on the weighted data above (HLTV data is most important), predict the match outcome.
Respond with ONLY valid JSON in this format:
{
  "predictedWinner": "Team Name",
  "confidence": 75,
  "predictedScore": "2-1",
  "keyFactors": ["Factor based on HLTV ranking", "Factor based on recent form", "Factor based on H2H"],
  "riskLevel": "low|medium|high",
  "briefAnalysis": "2-3 sentence analysis citing HLTV data"
}`;

  return prompt;
}

// Parse the AI prediction response
function parseAIPrediction(content, matchData) {
  try {
    // Try to extract JSON from the response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const prediction = JSON.parse(jsonMatch[0]);
      return {
        ...prediction,
        team1: matchData.team1,
        team2: matchData.team2,
        rawResponse: content,
        timestamp: new Date().toISOString()
      };
    }
  } catch (e) {
    console.log('Could not parse JSON, using text response');
  }

  // Fallback: create structured response from text
  return {
    predictedWinner: extractWinner(content, matchData),
    confidence: extractConfidence(content),
    briefAnalysis: content.substring(0, 500),
    team1: matchData.team1,
    team2: matchData.team2,
    rawResponse: content,
    timestamp: new Date().toISOString()
  };
}

// Helper to extract winner from text response
function extractWinner(content, matchData) {
  const lowerContent = content.toLowerCase();
  const team1Lower = matchData.team1.toLowerCase();
  const team2Lower = matchData.team2.toLowerCase();
  
  // Look for patterns like "X will win", "X should take", etc.
  const team1Mentions = (lowerContent.match(new RegExp(team1Lower, 'g')) || []).length;
  const team2Mentions = (lowerContent.match(new RegExp(team2Lower, 'g')) || []).length;
  
  if (team1Mentions > team2Mentions) {
    return matchData.team1;
  } else if (team2Mentions > team1Mentions) {
    return matchData.team2;
  }
  
  return 'Uncertain';
}

// Helper to extract confidence from text
function extractConfidence(content) {
  const percentMatch = content.match(/(\d{1,2}|100)\s*%/);
  if (percentMatch) {
    return parseInt(percentMatch[1]);
  }
  
  // Default confidence levels based on keywords
  const lowerContent = content.toLowerCase();
  if (lowerContent.includes('highly likely') || lowerContent.includes('very confident')) {
    return 80;
  } else if (lowerContent.includes('likely') || lowerContent.includes('should win')) {
    return 65;
  } else if (lowerContent.includes('close') || lowerContent.includes('toss-up')) {
    return 50;
  }
  
  return 55; // Default moderate confidence
}

// Install event - cache resources
chrome.runtime.onInstalled.addListener(() => {
  console.log('Major Predictor extension installed');
  
  // Set default settings
  chrome.storage.sync.get(['aiModel', 'showConfidence', 'includeHltv']).then(settings => {
    const defaults = {};
    if (!settings.aiModel) defaults.aiModel = 'anthropic/claude-3.5-sonnet';
    if (settings.showConfidence === undefined) defaults.showConfidence = true;
    if (settings.includeHltv === undefined) defaults.includeHltv = true;
    
    if (Object.keys(defaults).length > 0) {
      chrome.storage.sync.set(defaults);
    }
  });
});
