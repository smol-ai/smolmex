chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error(error));

chrome.tabs.onActivated.addListener((activeInfo) => {
  showSummary(activeInfo.tabId);
});
chrome.tabs.onUpdated.addListener(async (tabId) => {
  showSummary(tabId);
});

////////////////////////////
// Bearer Token Management //
////////////////////////////

// Listen for outgoing X.com API requests and extract Bearer token from Authorization header
chrome.webRequest.onBeforeSendHeaders.addListener(
  function(details) {
    try {
      const headers = details.requestHeaders || [];
      for (const header of headers) {
        if (header.name.toLowerCase() === 'authorization' && header.value.startsWith('Bearer ')) {
          const token = header.value.replace('Bearer ', '');
          bgLog('AUTH', `Extracted Bearer token from webRequest: ${token.slice(0,12)}...`, 'success');
          chrome.storage.local.set({ bearerToken: token });
          break;
        }
      }
    } catch (e) {
      bgLog('AUTH', `webRequest extraction error: ${e.message}`, 'error');
      bgLog('AUTH', `Error stack: ${e.stack}`, 'error');
    }
    return {};
  },
  {
    urls: [
      "https://x.com/i/api/*",
      "https://twitter.com/i/api/*"
    ]
  },
  ["requestHeaders"]
);

// On extension startup, send a test request to trigger Bearer token capture
chrome.runtime.onStartup.addListener(() => {
  bgLog('AUTH', 'Extension started, sending test request to x.com API to trigger Bearer token capture...', 'info');
  fetch('https://x.com/i/api/2/timeline/home.json', { credentials: 'include' })
    .then(resp => bgLog('AUTH', `Test request sent, response status: ${resp.status}`, resp.ok ? 'success' : 'warn'))
    .catch(e => {
      bgLog('AUTH', `Test request error: ${e.message}`, 'error');
      bgLog('AUTH', `Error stack: ${e.stack}`, 'error');
    });
});

// Helper: Color-coded log with timestamp
function bgLog(stage, msg, color = 'blue') {
  const colorMap = { info: 'blue', warn: 'orange', error: 'red', success: 'green' };
  const col = colorMap[color] || color;
  const ts = new Date().toISOString();
  console.log(`%c[BG][${stage}][${ts}] ${msg}`, `color:${col}; font-weight:bold;`);
}

// Fetch Bearer token from x.com (sample request)
async function fetchAndStoreBearerToken() {
  bgLog('AUTH', 'Attempting to fetch Bearer token from x.com...', 'info');
  try {
    // Send a lightweight request to x.com homepage (public, triggers auth headers)
    const resp = await fetch('https://x.com/home', { credentials: 'include' });
    const text = await resp.text();
    // Try to extract Bearer token from response (look for "AAAA" pattern)
    const match = text.match(/AAAA[A-Za-z0-9%]+/);
    if (match) {
      const token = match[0];
      bgLog('AUTH', `Bearer token found in response: ${token.slice(0,12)}...`, 'success');
      await chrome.storage.local.set({ bearerToken: token });
      return token;
    } else {
      bgLog('AUTH', 'Bearer token NOT found in response.', 'error');
      await chrome.storage.local.remove('bearerToken');
      return null;
    }
  } catch (e) {
    bgLog('AUTH', `Failed to fetch Bearer token: ${e.message}`, 'error');
    bgLog('AUTH', `Error stack: ${e.stack}`, 'error');
    await chrome.storage.local.remove('bearerToken');
    return null;
  }
}

// Listen for messages from sidepanel (requesting the Bearer token)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request && request.type === 'GET_BEARER_TOKEN') {
    bgLog('AUTH', 'Received GET_BEARER_TOKEN request from sidepanel', 'info');
    chrome.storage.local.get('bearerToken', async (result) => {
      let token = result.bearerToken;
      if (!token) {
        bgLog('AUTH', 'No bearerToken in storage, attempting to fetch...', 'warn');
        token = await fetchAndStoreBearerToken();
      }
      sendResponse({ bearerToken: token });
    });
    // Return true to indicate async response
    return true;
  }
});

async function showSummary(tabId) {
  const tab = await chrome.tabs.get(tabId);
  if (!tab.url.startsWith('http')) {
    return;
  }
  const injection = await chrome.scripting.executeScript({
    target: { tabId },
    files: ['scripts/extract-content.js']
  });
  chrome.storage.session.set({ pageContent: injection[0].result });
}
