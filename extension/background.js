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
  
  // Fetch external data if enabled
  let searchContext = '';
  if (settings.tavilyApiKey) {
    try {
      const query = `CS2 match prediction ${matchData.team1} vs ${matchData.team2} ${matchData.tournament || ''} recent results stats`;
      const searchResults = await searchTavily(query, settings.tavilyApiKey);
      if (searchResults) {
        searchContext = formatSearchResults(searchResults);
      }
    } catch (e) {
      console.error('Search failed:', e);
    }
  }

  // Build the prompt for prediction
  const prompt = buildPredictionPrompt(matchData, settings, searchContext);

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
            content: `You are an expert CS2 esports analyst. Analyze matches based on recent form, map pool, and head-to-head stats.
If search results are provided, prioritize that recent information.
Always respond with valid JSON.`
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: 1500,
        temperature: 0.5
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

async function searchTavily(query, apiKey) {
  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      api_key: apiKey,
      query: query,
      search_depth: "basic",
      include_answer: true,
      max_results: 3
    })
  });
  
  if (!response.ok) return null;
  return await response.json();
}

function formatSearchResults(data) {
  if (!data || !data.results) return '';
  return "Recent Information from Search:\n" + 
    data.results.map(r => `- ${r.title}: ${r.content}`).join('\n');
}

// Build the prompt for the AI model
function buildPredictionPrompt(matchData, settings, searchContext) {
  let prompt = `Analyze this CS2 match and provide a prediction:

**Match Details:**
- Team 1: ${matchData.team1}
- Team 2: ${matchData.team2}
- Tournament: ${matchData.tournament || 'Major Championship'}
- Match Type: ${matchData.matchType || 'Best of 3'}

**Analysis Request:**
Predict the winner based on team form and map pool.

${searchContext ? `\n**Search Context:**\n${searchContext}\n` : ''}

Please provide your response in the following JSON format:
{
  "predictedWinner": "Team Name",
  "confidence": 75,
  "predictedScore": "2-1",
  "keyFactors": [
    "Factor 1",
    "Factor 2"
  ],
  "riskLevel": "low|medium|high",
  "briefAnalysis": "Short summary"
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
