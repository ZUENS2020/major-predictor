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
  
  // Collect data from search
  let hltvSearchResults = null;
  let generalSearchResults = null;
  
  // Use Tavily to search HLTV for team data
  if (settings.tavilyApiKey) {
    try {
      // Search 1: HLTV specific search for team rankings and recent form
      const hltvQuery = `site:hltv.org "${matchData.team1}" "${matchData.team2}" 2024 2025 match results ranking`;
      console.log('Searching HLTV for:', hltvQuery);
      hltvSearchResults = await searchTavily(hltvQuery, settings.tavilyApiKey, ['hltv.org']);
      
      // Search 2: General search for recent news and form
      const generalQuery = `CS2 "${matchData.team1}" vs "${matchData.team2}" recent match 2024 2025 form`;
      console.log('Searching general:', generalQuery);
      generalSearchResults = await searchTavily(generalQuery, settings.tavilyApiKey);
    } catch (e) {
      console.error('Tavily search failed:', e);
    }
  }

  // Build the prompt with search results
  const prompt = buildPredictionPrompt(matchData, settings, hltvSearchResults, generalSearchResults);

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
            content: `You are an expert CS2 esports analyst specializing in Major tournament predictions. 

Your predictions should be based on:
1. HLTV search results (highest priority - official rankings, head-to-head records, recent results)
2. Recent news and match results from search
3. Your knowledge of team rosters, playstyles, and historical performance

IMPORTANT: Always include current HLTV world rankings for both teams in your analysis.
For example: "Natus Vincere #1" vs "FURIA #8"

If search results don't provide rankings, use your knowledge of current rankings (as of late 2024/early 2025).

Always cite specific data when available (rankings, recent results, H2H records).
Respond with valid JSON only.`
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

async function searchTavily(query, apiKey, includeDomains = null) {
  const body = {
    api_key: apiKey,
    query: query,
    search_depth: "advanced",
    include_answer: true,
    max_results: 5
  };
  
  if (includeDomains && includeDomains.length > 0) {
    body.include_domains = includeDomains;
  }
  
  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  
  if (!response.ok) {
    console.error('Tavily error:', await response.text());
    return null;
  }
  return await response.json();
}

function formatSearchResults(data, source = 'Search') {
  if (!data || !data.results || data.results.length === 0) return '';
  
  let text = `=== ${source} Results ===\n`;
  if (data.answer) {
    text += `Summary: ${data.answer}\n\n`;
  }
  text += data.results.map(r => {
    const content = r.content?.substring(0, 300) || '';
    return `• [${r.title}]\n  ${content}`;
  }).join('\n\n');
  return text;
}

// Build the prompt for the AI model
function buildPredictionPrompt(matchData, settings, hltvResults, generalResults) {
  let prompt = `Analyze this CS2 Major match and provide a prediction:

=== MATCH INFO ===
Team 1: ${matchData.team1}
Team 2: ${matchData.team2}
Tournament: ${matchData.tournament || 'StarLadder Budapest Major 2025'}
Match Type: Best of 3 (Swiss Stage)

`;

  // Add HLTV search results (highest priority)
  if (hltvResults && hltvResults.results && hltvResults.results.length > 0) {
    prompt += `=== HLTV DATA (Primary Source) ===\n`;
    if (hltvResults.answer) {
      prompt += `AI Summary: ${hltvResults.answer}\n\n`;
    }
    prompt += `Search Results:\n`;
    hltvResults.results.forEach((r, i) => {
      prompt += `${i+1}. ${r.title}\n   ${r.content?.substring(0, 400) || 'No content'}\n\n`;
    });
  } else {
    prompt += `=== HLTV DATA ===
(No search results available - use your knowledge of current HLTV rankings and recent results)

`;
  }

  // Add general search results (secondary)
  if (generalResults && generalResults.results && generalResults.results.length > 0) {
    prompt += `=== RECENT NEWS & CONTEXT ===\n`;
    if (generalResults.answer) {
      prompt += `Summary: ${generalResults.answer}\n\n`;
    }
    generalResults.results.slice(0, 3).forEach((r, i) => {
      prompt += `${i+1}. ${r.title}\n   ${r.content?.substring(0, 300) || ''}\n\n`;
    });
  }

  prompt += `=== PREDICTION INSTRUCTIONS ===
Based on the data above, predict the match outcome. Consider:
- Current HLTV rankings of both teams (MUST include in keyFactors)
- Recent form (last 3-5 matches)
- Head-to-head history
- Tournament stakes (Major Swiss stage)
- Map pool compatibility

Respond with ONLY valid JSON in this format:
{
  "predictedWinner": "Team Name (must match exactly team1 or team2)",
  "confidence": 65,
  "predictedScore": "2-1",
  "keyFactors": [
    "HLTV Ranking: Team1 #X vs Team2 #Y",
    "Recent form: Team1 W-L record vs Team2 W-L record",
    "Head-to-head: X-Y in recent matches"
  ],
  "riskLevel": "low|medium|high",
  "briefAnalysis": "2-3 sentence analysis with specific ranking numbers and recent results"
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
