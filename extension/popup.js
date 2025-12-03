// Popup script for Major Predictor extension

document.addEventListener('DOMContentLoaded', async () => {
  const apiStatus = document.getElementById('api-status');
  const pageStatus = document.getElementById('page-status');
  const predictBtn = document.getElementById('predict-btn');
  const settingsBtn = document.getElementById('settings-btn');
  const autoPredict = document.getElementById('auto-predict');

  // Check API key status
  const settings = await chrome.storage.sync.get(['openRouterApiKey', 'autoPredict']);
  
  if (settings.openRouterApiKey) {
    apiStatus.textContent = 'Connected';
    apiStatus.classList.remove('disconnected');
    apiStatus.classList.add('connected');
    predictBtn.disabled = false;
  } else {
    apiStatus.textContent = 'Not Configured';
    apiStatus.classList.add('disconnected');
    predictBtn.disabled = true;
  }

  // Load auto-predict setting
  autoPredict.checked = settings.autoPredict || false;

  // Check current tab
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url) {
      if (tab.url.includes('majors.im')) {
        pageStatus.textContent = 'majors.im ✓';
        pageStatus.classList.add('connected');
      } else {
        pageStatus.textContent = 'Not on majors.im';
        pageStatus.classList.add('disconnected');
        predictBtn.disabled = true;
      }
    }
  } catch (error) {
    pageStatus.textContent = 'Unknown';
  }

  // Predict button click
  predictBtn.addEventListener('click', async () => {
    predictBtn.disabled = true;
    predictBtn.textContent = '⏳ Analyzing...';

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.id) {
        await chrome.tabs.sendMessage(tab.id, { action: 'startPrediction' });
        predictBtn.textContent = '✅ Analysis Started';
        setTimeout(() => {
          predictBtn.textContent = '🎯 Analyze Matches';
          predictBtn.disabled = false;
        }, 2000);
      }
    } catch (error) {
      console.error('Error starting prediction:', error);
      predictBtn.textContent = '❌ Error';
      setTimeout(() => {
        predictBtn.textContent = '🎯 Analyze Matches';
        predictBtn.disabled = false;
      }, 2000);
    }
  });

  // Settings button click
  settingsBtn.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // Configure API Key link click
  const configLink = document.getElementById('config-link');
  if (configLink) {
    configLink.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.runtime.openOptionsPage();
    });
  }

  // Auto-predict toggle
  autoPredict.addEventListener('change', async (e) => {
    await chrome.storage.sync.set({ autoPredict: e.target.checked });
    
    // Notify content script about the change
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.id && tab.url && tab.url.includes('majors.im')) {
        await chrome.tabs.sendMessage(tab.id, { 
          action: 'updateAutoPredict', 
          value: e.target.checked 
        });
      }
    } catch (error) {
      console.error('Error updating auto-predict:', error);
    }
  });
});
