// Options page script for Major Predictor extension

document.addEventListener('DOMContentLoaded', async () => {
  const apiKeyInput = document.getElementById('api-key');
  const modelSelect = document.getElementById('model');
  const autoPredictToggle = document.getElementById('auto-predict');
  const showConfidenceToggle = document.getElementById('show-confidence');
  const includeHltvToggle = document.getElementById('include-hltv');
  const saveBtn = document.getElementById('save-btn');
  const testBtn = document.getElementById('test-btn');
  const alertSuccess = document.getElementById('alert-success');
  const alertError = document.getElementById('alert-error');

  // Load saved settings
  const settings = await chrome.storage.sync.get([
    'openRouterApiKey',
    'aiModel',
    'autoPredict',
    'showConfidence',
    'includeHltv'
  ]);

  if (settings.openRouterApiKey) {
    apiKeyInput.value = settings.openRouterApiKey;
  }
  if (settings.aiModel) {
    modelSelect.value = settings.aiModel;
  }
  autoPredictToggle.checked = settings.autoPredict || false;
  showConfidenceToggle.checked = settings.showConfidence !== false; // Default true
  includeHltvToggle.checked = settings.includeHltv !== false; // Default true

  // Show alert helper
  function showAlert(type, duration = 3000) {
    const alert = type === 'success' ? alertSuccess : alertError;
    alert.style.display = 'block';
    setTimeout(() => {
      alert.style.display = 'none';
    }, duration);
  }

  // Save settings
  saveBtn.addEventListener('click', async () => {
    const apiKey = apiKeyInput.value.trim();
    
    if (!apiKey) {
      alertError.textContent = '✗ Please enter an API key';
      showAlert('error');
      return;
    }

    try {
      await chrome.storage.sync.set({
        openRouterApiKey: apiKey,
        aiModel: modelSelect.value,
        autoPredict: autoPredictToggle.checked,
        showConfidence: showConfidenceToggle.checked,
        includeHltv: includeHltvToggle.checked
      });
      
      alertSuccess.textContent = '✓ Settings saved successfully!';
      showAlert('success');
    } catch (error) {
      console.error('Error saving settings:', error);
      alertError.textContent = '✗ Error saving settings';
      showAlert('error');
    }
  });

  // Test API connection
  testBtn.addEventListener('click', async () => {
    const apiKey = apiKeyInput.value.trim();
    
    if (!apiKey) {
      alertError.textContent = '✗ Please enter an API key first';
      showAlert('error');
      return;
    }

    testBtn.disabled = true;
    testBtn.textContent = '⏳ Testing...';

    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://majors.im',
          'X-Title': 'Major Predictor'
        },
        body: JSON.stringify({
          model: modelSelect.value,
          messages: [
            { role: 'user', content: 'Say "API connection successful" in exactly those words.' }
          ],
          max_tokens: 50
        })
      });

      if (response.ok) {
        alertSuccess.textContent = '✓ API connection successful!';
        showAlert('success');
      } else {
        const error = await response.json();
        alertError.textContent = `✗ API Error: ${error.error?.message || 'Unknown error'}`;
        showAlert('error', 5000);
      }
    } catch (error) {
      console.error('API test error:', error);
      alertError.textContent = '✗ Network error: Could not connect to OpenRouter';
      showAlert('error');
    } finally {
      testBtn.disabled = false;
      testBtn.textContent = '🔍 Test API';
    }
  });
});
