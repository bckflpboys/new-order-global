// New Order Global — OpenRouter AI Service
// Handles communication with OpenRouter API for tool generation

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

// ============================================
// System Prompt — The brain of tool generation
// ============================================
const SYSTEM_PROMPT = `You are **New Order** — an AI that creates Chrome extension tools.

When a user describes what they want, you generate a complete, working Chrome extension tool.

## OUTPUT FORMAT
You MUST return a valid JSON object with this exact structure:
\`\`\`json
{
  "name": "Tool Name",
  "description": "Brief description of what this tool does",
  "icon": "emoji icon for the tool",
  "targetSites": ["*://example.com/*"],
  "contentScript": "// JavaScript code that runs on the target page",
  "styles": "/* CSS styles injected into the page */",
  "config": {},
  "storageSchema": {}
}
\`\`\`

## RULES FOR GENERATED CODE

### General
- All code must be self-contained vanilla JavaScript (NO frameworks, NO imports)
- All UI must be injected into the page DOM directly
- Mark all injected elements with \`data-no-tool="TOOL_ID"\` attribute
- Include error handling (try/catch) for all operations
- Add console.log statements for debugging with prefix "[New Order]"

### Available APIs (already provided by runtime):
- \`ToolStorage.get(key)\` — get stored data
- \`ToolStorage.set(key, value)\` — save data
- \`ToolStorage.getAll()\` — get all stored data for this tool
- \`ToolStorage.clear()\` — clear all tool data
- \`downloadData(data, filename, mimeType)\` — trigger file download
- \`showToolToast(message)\` — show a notification toast
- \`TOOL_ID\` — unique ID of this tool
- \`TOOL_NAME\` — name of this tool

### Data Collection Tools
When the tool needs to collect data (emails, links, text, etc.):
1. Create a floating panel UI to show collected data
2. Include a counter showing how many items collected
3. Add an export/download button (CSV for tabular data, JSON otherwise)
4. Add a "Clear" button to reset collected data
5. Auto-save collected data using ToolStorage
6. Load previously collected data on page load

### UI Design Guidelines
- Use a floating panel anchored to bottom-right or top-right
- Dark theme: background #1a1a28, text #f0f0f5, accent #7c5cfc
- Border-radius: 12px, subtle box-shadow
- Make panels draggable with a header bar
- Include a minimize/close button
- Use smooth transitions (0.2s ease)
- Z-index: 99999 to stay on top
- Font: system-ui, -apple-system, sans-serif
- Keep it compact and non-intrusive

### Target Sites
- Use Chrome extension match patterns: \`*://example.com/*\`
- For "any website" or "all sites", use: \`["*://*/*"]\`
- Be specific when the user mentions a specific site
- For subdomains, use: \`*://*.example.com/*\`

## IMPORTANT
- Return ONLY the JSON object, no markdown code fences, no explanation
- The contentScript should be raw JavaScript that executes immediately
- The styles should be raw CSS without any wrapper
- Make the tool actually useful and complete — no placeholders
- If collecting data, always include export/download functionality
- If the user's request is unclear, make reasonable assumptions and build the most useful version`;

// ============================================
// Generate a tool from user prompt
// ============================================
async function generateToolFromPrompt(prompt, context = {}) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('OpenRouter API key not configured');
  }

  const model = process.env.OPENROUTER_MODEL || 'anthropic/claude-sonnet-4-20250514';

  // Build context message
  let contextInfo = '';
  if (context.currentSite) {
    contextInfo += `\nUser is currently on: ${context.currentSite}`;
  }
  if (context.currentUrl) {
    contextInfo += `\nFull URL: ${context.currentUrl}`;
  }
  if (context.pageTitle) {
    contextInfo += `\nPage title: ${context.pageTitle}`;
  }

  const userMessage = contextInfo
    ? `${prompt}\n\n[Context: ${contextInfo}]`
    : prompt;

  const response = await fetch(OPENROUTER_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': process.env.FRONTEND_URL || 'https://global-order.32d.one',
      'X-Title': 'New Order Global'
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage }
      ],
      temperature: 0.7,
      max_tokens: 8000,
      response_format: { type: 'json_object' }
    })
  });

  if (!response.ok) {
    const errorData = await response.text();
    console.error('OpenRouter API error:', response.status, errorData);
    throw new Error(`AI service error (${response.status})`);
  }

  const data = await response.json();

  if (!data.choices || data.choices.length === 0) {
    throw new Error('No response from AI');
  }

  const content = data.choices[0].message?.content;
  if (!content) {
    throw new Error('Empty AI response');
  }

  // Parse the JSON response
  let tool;
  try {
    // Try direct parse first
    tool = JSON.parse(content);
  } catch {
    // Try extracting JSON from markdown code block
    const jsonMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (jsonMatch) {
      tool = JSON.parse(jsonMatch[1]);
    } else {
      // Try finding JSON object in the response
      const objMatch = content.match(/\{[\s\S]*\}/);
      if (objMatch) {
        tool = JSON.parse(objMatch[0]);
      } else {
        throw new Error('Could not parse AI response as JSON');
      }
    }
  }

  // Validate required fields
  if (!tool.name) tool.name = 'Custom Tool';
  if (!tool.contentScript) throw new Error('AI did not generate any code');
  if (!tool.targetSites || tool.targetSites.length === 0) {
    tool.targetSites = ['*://*/*'];
  }

  // Generate a unique ID
  tool.id = 'tool_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);

  return {
    tool,
    usage: data.usage || {},
    model: data.model || model
  };
}

// ============================================
// Iterate on existing tool
// ============================================
async function iterateToolFromFeedback(existingTool, feedback, chatHistory = []) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('OpenRouter API key not configured');
  }

  const model = process.env.OPENROUTER_MODEL || 'anthropic/claude-sonnet-4-20250514';

  // Build messages from chat history
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...chatHistory.map(msg => ({
      role: msg.role,
      content: msg.content
    })),
    {
      role: 'user',
      content: `Here is the current tool code:\n\nName: ${existingTool.name}\nTarget Sites: ${existingTool.targetSites?.join(', ')}\n\nJavaScript:\n${existingTool.contentScript}\n\nCSS:\n${existingTool.styles || 'none'}\n\nUser feedback / changes requested:\n${feedback}\n\nPlease update the tool based on this feedback. Return the complete updated tool as JSON.`
    }
  ];

  const response = await fetch(OPENROUTER_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': process.env.FRONTEND_URL || 'https://global-order.32d.one',
      'X-Title': 'New Order Global'
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.7,
      max_tokens: 8000,
      response_format: { type: 'json_object' }
    })
  });

  if (!response.ok) {
    throw new Error(`AI service error (${response.status})`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error('Empty AI response');
  }

  let tool;
  try {
    tool = JSON.parse(content);
  } catch {
    const jsonMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (jsonMatch) {
      tool = JSON.parse(jsonMatch[1]);
    } else {
      const objMatch = content.match(/\{[\s\S]*\}/);
      if (objMatch) {
        tool = JSON.parse(objMatch[0]);
      } else {
        throw new Error('Could not parse AI response');
      }
    }
  }

  // Preserve the original tool ID
  tool.id = existingTool.id;
  tool.version = (existingTool.version || 1) + 1;

  return {
    tool,
    usage: data.usage || {},
    model: data.model || model
  };
}

module.exports = { generateToolFromPrompt, iterateToolFromFeedback };
