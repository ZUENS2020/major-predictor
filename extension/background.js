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

  const model = settings.aiModel || 'openai/gpt-4o-mini'; // Fast model by default
  
  // Collect data from search
  let hltvSearchResults = null;
  
  // Get current date and last 3 months for search
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth(); // 0-11
  const months = [];
  for (let i = 0; i < 3; i++) {
    const d = new Date(currentYear, currentMonth - i, 1);
    months.push(d.toLocaleString('en-US', { month: 'long' }));
  }
  const monthsStr = months.join(' ');
  const yearsStr = currentMonth < 2 ? `${currentYear - 1} ${currentYear}` : `${currentYear}`;
  
  // Use Tavily to search HLTV for team data (with 10 second timeout)
  if (settings.tavilyApiKey && settings.includeHltv !== false) {
    try {
      const hltvQuery = `site:hltv.org "${matchData.team1}" "${matchData.team2}" ${monthsStr} ${yearsStr} match ranking`;
      console.log('Searching HLTV for:', hltvQuery);
      
      // 10 second timeout for search
      hltvSearchResults = await Promise.race([
        searchTavily(hltvQuery, settings.tavilyApiKey, ['hltv.org']),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Search timeout')), 10000))
      ]).catch(e => {
        console.log('Search skipped:', e.message);
        return null;
      });
    } catch (e) {
      console.error('Tavily search failed:', e);
    }
  }

  // Build the prompt with search results
  const prompt = buildPredictionPrompt(matchData, settings, hltvSearchResults);

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
            content: `You are a CS2 esports analyst. Today: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}. Analyze matches based on H2H last 3 months, HLTV rankings, map pools, recent form. Respond with JSON only.`
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: 800,
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
function buildPredictionPrompt(matchData, settings, hltvResults) {
  // Get current date dynamically
  const now = new Date();
  const currentDateStr = now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();
  
  // Calculate last 3 months
  const last3Months = [];
  for (let i = 0; i < 3; i++) {
    const d = new Date(currentYear, currentMonth - i, 1);
    last3Months.push(d.toLocaleString('en-US', { month: 'long', year: 'numeric' }));
  }
  const last3MonthsStr = last3Months.join(', ');
  
  // Determine match format from tournament info
  const matchFormat = matchData.matchFormat || 'BO3';
  
  let prompt = `Analyze this CS2 Major match:

=== MATCH INFO ===
Team 1: ${matchData.team1}
Team 2: ${matchData.team2}
Tournament: ${matchData.tournament || 'StarLadder Budapest Major 2025'}
Format: ${matchFormat} (Swiss Stage)
Date: ${currentDateStr}

`;

  // Add HLTV search results
  if (hltvResults && hltvResults.results && hltvResults.results.length > 0) {
    prompt += `=== HLTV DATA ===\n`;
    if (hltvResults.answer) {
      prompt += `Summary: ${hltvResults.answer}\n\n`;
    }
    hltvResults.results.slice(0, 5).forEach((r, i) => {
      prompt += `${i+1}. ${r.title}\n   ${r.content?.substring(0, 400) || ''}\n\n`;
    });
  } else {
    prompt += `=== HLTV DATA ===\n(No search results - use your knowledge of HLTV rankings, H2H, map pools)\n\n`;
  }

  prompt += `=== PREDICT ===
Consider (priority order):
1. H2H last 3 months (${last3MonthsStr}) - STRONGEST indicator
2. HLTV rankings & evaluations
3. Map pool (${matchFormat}: ${matchFormat === 'BO1' ? 'map pick crucial' : 'deep pool wins'})
4. Recent form

JSON response only:
{
  "predictedWinner": "exact team name",
  "confidence": 65,
  "keyFactors": ["H2H: ...", "Ranking: #X vs #Y", "Maps: ..."],
  "riskLevel": "low|medium|high",
  "briefAnalysis": "2-3 sentences"
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
