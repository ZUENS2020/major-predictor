// Options page script for Major Predictor extension

document.addEventListener('DOMContentLoaded', async () => {
  const apiKeyInput = document.getElementById('api-key');
  const modelSelect = document.getElementById('model');
  const autoPredictToggle = document.getElementById('auto-predict');
  const showConfidenceToggle = document.getElementById('show-confidence');
  const includeHltvToggle = document.getElementById('include-hltv');
  const saveBtn = document.getElementById('save-btn');
  const testBtn = document.getElementById('test-btn');
  const refreshModelsBtn = document.getElementById('refresh-models-btn');
  const alertSuccess = document.getElementById('alert-success');
  const alertError = document.getElementById('alert-error');

  // Default models as fallback
  const defaultModels = [
    { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet (Recommended)' },
    { id: 'anthropic/claude-3-haiku', name: 'Claude 3 Haiku (Fast)' },
    { id: 'openai/gpt-4o', name: 'GPT-4o' },
    { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini (Budget)' },
    { id: 'google/gemini-pro-1.5', name: 'Gemini Pro 1.5' },
    { id: 'meta-llama/llama-3.1-70b-instruct', name: 'Llama 3.1 70B' }
  ];

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
  autoPredictToggle.checked = settings.autoPredict || false;
  showConfidenceToggle.checked = settings.showConfidence !== false; // Default true
  includeHltvToggle.checked = settings.includeHltv !== false; // Default true

  // Fetch models from OpenRouter
  async function fetchModels() {
    modelSelect.innerHTML = '<option value="">Loading models...</option>';
    modelSelect.disabled = true;
    if (refreshModelsBtn) refreshModelsBtn.disabled = true;

    try {
      const response = await fetch('https://openrouter.ai/api/v1/models', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        const data = await response.json();
        const models = data.data || [];
        
        // Sort models by name and filter for chat models
        const chatModels = models
          .filter(m => m.id && m.name)
          .sort((a, b) => {
            // Prioritize popular providers
            const priority = ['anthropic', 'openai', 'google', 'meta-llama'];
            const aProvider = a.id.split('/')[0];
            const bProvider = b.id.split('/')[0];
            const aPriority = priority.indexOf(aProvider);
            const bPriority = priority.indexOf(bProvider);
            
            if (aPriority !== -1 && bPriority === -1) return -1;
            if (aPriority === -1 && bPriority !== -1) return 1;
            if (aPriority !== -1 && bPriority !== -1) return aPriority - bPriority;
            
            return a.name.localeCompare(b.name);
          });

        populateModelSelect(chatModels);
        
        // Restore selected model
        if (settings.aiModel) {
          modelSelect.value = settings.aiModel;
        }
        // If saved model not found or no saved model, select first option
        if (!modelSelect.value && chatModels.length > 0) {
          modelSelect.value = chatModels[0].id;
        }
      } else {
        console.error('Failed to fetch models:', response.status);
        populateModelSelect(defaultModels);
        if (settings.aiModel) modelSelect.value = settings.aiModel;
      }
    } catch (error) {
      console.error('Error fetching models:', error);
      populateModelSelect(defaultModels);
      if (settings.aiModel) modelSelect.value = settings.aiModel;
    } finally {
      modelSelect.disabled = false;
      if (refreshModelsBtn) refreshModelsBtn.disabled = false;
    }
  }

  // Populate the model select dropdown
  function populateModelSelect(models) {
    modelSelect.innerHTML = '';
    
    if (models.length === 0) {
      modelSelect.innerHTML = '<option value="">No models available</option>';
      return;
    }

    models.forEach(model => {
      const option = document.createElement('option');
      option.value = model.id;
      option.textContent = model.name || model.id;
      modelSelect.appendChild(option);
    });
  }

  // Initial fetch of models
  await fetchModels();

  // Refresh models button
  if (refreshModelsBtn) {
    refreshModelsBtn.addEventListener('click', async () => {
      await fetchModels();
      alertSuccess.textContent = '✓ Models refreshed!';
      showAlert('success');
    });
  }

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
