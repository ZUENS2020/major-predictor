# Major Predictor 🎯

A browser extension that predicts CS2 match outcomes on [majors.im](https://majors.im) using AI analysis powered by OpenRouter API. The extension analyzes team performance data from HLTV.org and recent evaluations to provide intelligent match predictions.

## Features

- 🤖 **AI-Powered Predictions**: Uses advanced language models via OpenRouter API to analyze matches
- 📊 **HLTV Integration**: Considers team statistics, match history, and rankings from HLTV.org
- 🎯 **Confidence Scores**: Each prediction includes a confidence percentage
- 📈 **Key Factors**: Understand why the AI made its prediction
- 🗺️ **Map Analysis**: Get insights into map pools and likely map picks
- ⚡ **Auto-Predict**: Automatically analyze matches when visiting majors.im
- 🌙 **Dark Mode**: Beautiful dark theme that matches modern esports aesthetics

## Installation

### Chrome / Edge / Brave

1. Download or clone this repository
2. Open your browser and navigate to the extensions page:
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`
   - Brave: `brave://extensions`
3. Enable "Developer mode" (toggle in the top right)
4. Click "Load unpacked"
5. Select the `extension` folder from this repository

### Firefox

Firefox support requires additional manifest modifications. Coming soon!

## Configuration

### Getting an OpenRouter API Key

1. Visit [OpenRouter](https://openrouter.ai/) and create an account
2. Go to [API Keys](https://openrouter.ai/keys) section
3. Create a new API key
4. Copy the key (starts with `sk-or-v1-...`)

### Setting Up the Extension

1. Click the Major Predictor icon in your browser toolbar
2. Click "⚙️ Settings" or navigate to the extension options
3. Paste your OpenRouter API key
4. Choose your preferred AI model:
   - **Claude 3.5 Sonnet** (Recommended) - Best accuracy
   - **Claude 3 Haiku** - Faster, good for quick analysis
   - **GPT-4o** - OpenAI's latest model
   - **GPT-4o Mini** - Budget-friendly option
   - **Gemini Pro 1.5** - Google's model
   - **Llama 3.1 70B** - Open source alternative
5. Click "💾 Save Settings"
6. Use "🔍 Test API" to verify your connection

## Usage

### Manual Analysis

1. Visit [majors.im](https://majors.im)
2. Click the Major Predictor icon in your toolbar
3. Click "🎯 Analyze Matches"
4. Wait for predictions to appear next to each match

### Auto Analysis

1. Enable "Auto Predict" in settings
2. Visit majors.im - predictions will appear automatically

### Understanding Predictions

Each prediction badge shows:
- **Predicted Winner**: The team AI expects to win
- **Confidence**: How confident the AI is (%)
- **Hover for Details**: See key factors, map analysis, and risk level

Color coding:
- 🟢 Green badge: Team 1 predicted to win
- 🔵 Blue badge: Team 2 predicted to win
- 🟡 Yellow badge: Uncertain/close match

## Supported Tournaments

The extension works on majors.im and analyzes matches from various CS2 tournaments including:
- CS2 Majors (Copenhagen, Shanghai, etc.)
- IEM events
- ESL Pro League
- BLAST tournaments
- RMR events
- And more!

## Data Sources

The AI considers:
- Team match history from HLTV.org
- Recent team performance and rankings
- Head-to-head statistics
- Map pool strengths/weaknesses
- Recent roster changes
- Tournament context

## Privacy

- Your API key is stored locally in your browser
- No data is collected or sent to third parties
- All predictions are made via your own OpenRouter account
- Extension only activates on majors.im

## Development

### Project Structure

```
extension/
├── manifest.json       # Extension configuration
├── popup.html/js       # Popup UI
├── options.html/js     # Settings page
├── content.js          # Injected into majors.im
├── background.js       # Service worker for API calls
├── styles.css          # Additional styles
└── icons/              # Extension icons
```

### Building from Source

No build step required! The extension runs directly from the source files.

### Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## Disclaimer

⚠️ **This extension is for entertainment purposes only.**

- Predictions are AI-generated and may not be accurate
- Do not use predictions for gambling or betting decisions
- Past performance does not guarantee future results
- The developers are not responsible for any losses

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Credits

- [OpenRouter](https://openrouter.ai/) for AI API access
- [HLTV.org](https://www.hltv.org/) for CS2 statistics
- [majors.im](https://majors.im/) for tournament brackets

---

Made with ❤️ for the CS2 community