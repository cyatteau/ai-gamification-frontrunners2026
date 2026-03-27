# AI-Powered Gamification for the Web

Slides, demos, and code from my **AI-Powered Gamification for the Web** conference talk.

This repo includes:
- a PDF of the slide deck
- safe demo versions for reference and sharing
- starter code for the examples shown in the talk

## What this talk is about

This talk explores how AI can support gamified web experiences in ways that feel more responsive and less gimmicky.

The examples in this repo focus on:
- **dynamic content generation**
- **sentiment-aware feedback**
- **adaptive challenge tuning**
- **combining these patterns into one app experience**

The demo set includes examples using:
- **OpenAI** for structured generation
- **Azure AI Language** for sentiment analysis
- **TensorFlow.js** for browser-side adaptation

## Slides

- [Slides PDF](https://github.com/cyatteau/ai-gamification-frontrunners2026/blob/main/Slides.pdf)

## Demos

### Demo 1: Dynamic Fact Finder
A location-based demo that generates structured fact cards and lightweight rewards.

Highlights:
- place grounding with ArcGIS services
- structured output for UI-friendly content
- safe local-server setup for demo use

### Demo 2: Sentiment-Aware Feedback
A checkpoint-style demo that reacts to player tone and chooses a better feedback path.

Highlights:
- sentiment analysis on a short reflection
- route selection based on tone
- visible UI changes based on the result

### Demo 3: Adaptive Challenge Tuning
A browser-based demo that adjusts challenge level based on correctness, response time, and current difficulty.

Highlights:
- TensorFlow.js running in the browser
- small local prediction loop
- visible pacing changes in the UI

### GeoExplorer
A combined-app demo that brings multiple patterns into one experience.

Highlights:
- quiz mode with adaptive difficulty
- sentiment mode with recap
- badges, unlocks, and visible progression

## Running locally

Some demos in this repo are safe sharing versions for presentation and reference.

If you want to run the local-server demo, create your own environment file and add your own credentials.

## Notes

- This repo is intended for learning, presentation sharing, and experimentation.
- Public versions do **not** include private production credentials.
- If you want to run certain demos locally, use your own API keys and tokens.

## Related docs

- OpenAI recommends the **Responses API** for new projects: <https://developers.openai.com/api/docs/guides/migrate-to-responses/>
- TensorFlow.js runs in the **browser or Node.js**: <https://www.tensorflow.org/js>

