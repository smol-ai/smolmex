////////////////////////////
////////////////////////////
////////////////////////////
////////////////////////////
////////////////////////////
////////////////////////////
////////////////////////////
////////////////////////////
////////////////////////////
// actual code STARTS HERE
////////////////////////////
////////////////////////////
////////////////////////////
////////////////////////////
////////////////////////////
////////////////////////////
////////////////////////////
////////////////////////////
////////////////////////////

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

// [INFO][BG][timestamp] Relay messages from sidepanel to content script for TID generation
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.action === 'relayToActiveTab') {
    // [INFO][BG][timestamp] Relaying message to active Twitter/X tab
    chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
      const twitterTab = tabs.find(tab => tab.url && (/twitter\.com|x\.com/).test(tab.url));
      if (!twitterTab) {
        console.error('[BG][' + new Date().toISOString() + '] No active Twitter/X tab found.');
        sendResponse({ error: 'No active Twitter/X tab found.' });
        return;
      }
      chrome.tabs.sendMessage(twitterTab.id, message.payload, (response) => {
        if (chrome.runtime.lastError) {
          console.error('[BG][' + new Date().toISOString() + '] Error relaying to content script:', chrome.runtime.lastError.message);
          sendResponse({ error: chrome.runtime.lastError.message });
        } else {
          sendResponse(response);
        }
      });
    });
    return true; // Indicate async response
  }
});

// Listen for outgoing X.com API requests and extract Bearer token, x-csrf-token, and x-client-transaction-id from headers
chrome.webRequest.onBeforeSendHeaders.addListener(
  function(details) {
    try {
      const headers = details.requestHeaders || [];
      let found = false;
      let bearerToken = undefined;
      let csrfToken = undefined;
      let transactionId = undefined;
      for (const header of headers) {
        const name = header.name.toLowerCase();
        if (name === 'authorization' && header.value.startsWith('Bearer ')) {
          bearerToken = header.value.replace('Bearer ', '');
          // bgLog('AUTH', `Extracted Bearer token from webRequest: ${bearerToken.slice(0,12)}...`, 'success');
          found = true;
        }
        if (name === 'x-csrf-token') {
          csrfToken = header.value;
          // bgLog('AUTH', `Extracted x-csrf-token from webRequest: ${csrfToken.slice(0,12)}...`, 'success');
          found = true;
        }
        if (name === 'x-client-transaction-id') {
          transactionId = header.value;
          // bgLog('AUTH', `Extracted x-client-transaction-id from webRequest: ${transactionId.slice(0,12)}...`, 'success');
          found = true;
        }
      }
      if (found) {
        chrome.storage.local.set({
          ...(bearerToken && { bearerToken }),
          ...(csrfToken && { csrfToken }),
          ...(transactionId && { transactionId })
        });
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

// Listen for messages from sidepanel (requesting auth tokens)
// Load utility functions for background script compatibility (Chrome extensions do not support ES module imports here)
// importScripts('utils.js');

// Utility for fetching and parsing Twitter's main.js to extract the SearchTimeline queryId
// Major assumptions and warnings:
// - Twitter may change the structure of their JS bundle at any time, which may break this parser.
// - This fetch is rate-limited and cached to avoid excessive requests and delays.
// - Color-coded logs are used for each stage, and errors are logged with all relevant state.

const SEARCH_QUERYID_CACHE_KEY = 'searchTimelineQueryIdCache';
const SEARCH_QUERYID_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// Helper: Color-coded log with timestamp (for background.js, but can be used here for consistency)
function utilLog(stage, msg, color = 'blue') {
  const colorMap = { info: 'blue', warn: 'orange', error: 'red', success: 'green' };
  const col = colorMap[color] || color;
  const ts = new Date().toISOString();
  console.log(`%c[UTIL][${stage}][${ts}] ${msg}`, `color:${col}; font-weight:bold;`);
}

// Fetch and parse SearchTimeline queryId from Twitter main.js
async function getSearchTimelineQueryId() {
  utilLog('QUERYID', 'Starting getSearchTimelineQueryId()', 'info');
  // Check cache first
  const cache = await new Promise(resolve => {
    chrome.storage.local.get([SEARCH_QUERYID_CACHE_KEY], resolve);
  });
  const cached = cache[SEARCH_QUERYID_CACHE_KEY];
  if (cached && Date.now() - cached.timestamp < SEARCH_QUERYID_CACHE_TTL_MS) {
    utilLog('QUERYID', `Returning cached queryId: ${cached.queryId}`, 'success');
    return cached.queryId;
  }
  try {
    // 1. Fetch Twitter home page to find main.js URL
    utilLog('QUERYID', 'Fetching Twitter home page...', 'info');
    const resp = await fetch('https://twitter.com/', { credentials: 'omit' });
    const html = await resp.text();
    // 2. Find main.*.js URL
    const mainJsMatch = html.match(/https:\/\/abs.twimg.com\/responsive-web\/client-web\/main\.[a-z0-9]+.js/);
    if (!mainJsMatch) {
      utilLog('QUERYID', 'Could not find main.*.js URL in Twitter home page', 'error');
      throw new Error('main.js not found');
    }
    const mainJsUrl = mainJsMatch[0];
    utilLog('QUERYID', `Found main.js URL: ${mainJsUrl}`, 'success');
    // 3. Fetch main.js
    utilLog('QUERYID', 'Fetching main.js...', 'info');
    const jsResp = await fetch(mainJsUrl, { credentials: 'omit' });
    const js = await jsResp.text();
    // 4. Find the SearchTimeline queryId
    // Regex: find {queryId:"...",operationName:"SearchTimeline",...}
    const objMatch = js.match(/\{[^}]*queryId:"([^"]+)",[^}]*operationName:"SearchTimeline"[^}]*\}/);
    if (!objMatch) {
      utilLog('QUERYID', 'Could not find SearchTimeline query object in main.js', 'error');
      throw new Error('SearchTimeline query object not found');
    }
    const queryId = objMatch[1];
    utilLog('QUERYID', `Extracted queryId: ${queryId}`, 'success');
    // Cache
    await chrome.storage.local.set({
      [SEARCH_QUERYID_CACHE_KEY]: { queryId, timestamp: Date.now() }
    });
    return queryId;
  } catch (e) {
    utilLog('QUERYID', `Error: ${e.message}`, 'error');
    utilLog('QUERYID', `Stack: ${e.stack}`, 'error');
    // Save error state to cache for debugging
    await chrome.storage.local.set({
      [SEARCH_QUERYID_CACHE_KEY]: { queryId: null, timestamp: Date.now(), error: e.message, stack: e.stack }
    });
    return null;
  }
}
// getSearchTimelineQueryId is now available globally

// Listen for messages from sidepanel (requesting auth tokens and queryId)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request && request.type === 'GET_AUTH_TOKENS') {
    bgLog('AUTH', 'Received GET_AUTH_TOKENS request from sidepanel', 'info');
    // Fetch tokens from storage
    chrome.storage.local.get(['bearerToken', 'csrfToken', 'transactionId'], async (result) => {
      const { bearerToken, csrfToken, transactionId } = result;
      bgLog('AUTH', `Tokens: Bearer: ${bearerToken ? bearerToken.slice(0,12)+'...' : 'none'}, CSRF: ${csrfToken ? csrfToken.slice(0,12)+'...' : 'none'}, TransactionId: ${transactionId ? transactionId.slice(0,12)+'...' : 'none'}`, 'info');
      // Fetch the current SearchTimeline queryId
      let searchTimelineQueryId = null;
      try {
        searchTimelineQueryId = await getSearchTimelineQueryId();
        bgLog('QUERYID', `Returning queryId: ${searchTimelineQueryId}`, searchTimelineQueryId ? 'success' : 'warn');
      } catch (e) {
        bgLog('QUERYID', `Failed to get queryId: ${e.message}`, 'error');
        bgLog('QUERYID', `Error stack: ${e.stack}`, 'error');
        searchTimelineQueryId = 'nKAncKPF1fV1xltvF3UUlw'; /// hardcode fallback
      }
      // Return all tokens and the queryId to the sidepanel
      sendResponse({ bearerToken, csrfToken, transactionId, searchTimelineQueryId });
    });
    // Return true to indicate async response
    return true;
  }
});

// Major assumptions:
// - Twitter may change the structure of their JS bundle, which could break the parser in utils.js.
// - This fetch is rate-limited and cached to avoid excessive requests.
// - All logs are color-coded and timestamped for easier debugging.


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
