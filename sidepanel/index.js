// [INFO][2025-05-18T16:29:53-07:00][INIT] smol-twemex sidepanel/index.js loaded
// This script runs in the X.COM extension sidepanel and fetches profile data using the user's real session tokens.
// Major assumptions:
// - Extension has "cookies" permission for https://x.com/* in manifest.json
// - User is logged in to x.com
// - Bearer token is stored in localStorage (common for Twitter/X web)
// - CSRF token is stored in cookie named 'ct0'
// - Only runs on profile pages (e.g., x.com/altryne)
//
// WARNING: If permissions are missing or user is not on a profile page, this will not fetch.

//////////////////////
// Utility Functions //
//////////////////////

// Color-coded log helper
const log = (stage, msg, color = 'blue') => {
  const colorMap = { info: 'blue', warn: 'orange', error: 'red', success: 'green' };
  const col = colorMap[color] || color;
  const ts = new Date().toISOString();
  console.log(`%c[${stage}][${ts}] ${msg}`, `color:${col}; font-weight:bold;`);
};

// Utility: Get the real URL of the active tab using Chrome Extensions API
async function getActiveTabUrl() {
  return new Promise((resolve) => {
    if (!chrome.tabs) {
      log('URL', 'chrome.tabs API not available. Falling back to window.location.', 'warn');
      resolve(window.location.href);
      return;
    }
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      if (chrome.runtime.lastError) {
        log('URL', `chrome.tabs.query error: ${chrome.runtime.lastError.message}. Falling back to window.location.`, 'warn');
        resolve(window.location.href);
        return;
      }
      const url = tabs[0]?.url;
      log('URL', `Active tab URL: ${url}`, url ? 'info' : 'warn');
      resolve(url || window.location.href);
    });
  });
}

// Check if a given URL is a valid X.COM profile page (e.g., /altryne, not /home or /notifications)
function isProfilePageFromUrl(url) {
  try {
    const u = new URL(url);
    const path = u.pathname;
    log('isProfilePage', `Checking path: ${path}`, 'info');
    // Exclude common non-profile paths
    const nonProfiles = [
      '', '/', '/home', '/explore', '/notifications', '/messages', '/settings', '/compose', '/search', '/login', '/signup', '/i', '/logout', '/tos', '/privacy', '/about', '/help', '/terms'
    ];
    return /^\/[A-Za-z0-9_]+$/.test(path) && !nonProfiles.includes(path);
  } catch (e) {
    log('isProfilePage', `Invalid URL: ${url} (${e.message})`, 'error');
    return false;
  }
}

// Extract username from a profile page URL
function getProfileUsernameFromUrl(url) {
  try {
    const u = new URL(url);
    const match = u.pathname.match(/^\/([A-Za-z0-9_]+)$/);
    return match ? match[1] : null;
  } catch (e) {
    log('getProfileUsername', `Invalid URL: ${url} (${e.message})`, 'error');
    return null;
  }
}



// Get Bearer token from background script via messaging
async function getAuthTokens() {
  log('AUTH', 'Requesting Bearer token from background script...', 'info');
  try {
    return await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'GET_AUTH_TOKENS' }, (response) => {
        if (chrome.runtime.lastError) {
          log('AUTH', `chrome.runtime.lastError: ${chrome.runtime.lastError.message}`, 'error');
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!response || (!response.bearerToken && !response.csrfToken && !response.transactionId)) {
          log('AUTH', 'No auth tokens received from background script.', 'error');
          reject(new Error('No auth tokens received'));
          return;
        }
        log('AUTH', `Received from background: Bearer: ${response.bearerToken ? response.bearerToken.slice(0,12)+'...' : 'none'}, CSRF: ${response.csrfToken ? response.csrfToken.slice(0,12)+'...' : 'none'}, TransactionId: ${response.transactionId ? response.transactionId.slice(0,12)+'...' : 'none'}`, 'success');
        resolve(response);
      });
    });
  } catch (e) {
    log('AUTH', `Failed to get auth tokens: ${e.message}`, 'error');
    log('AUTH', `Error stack: ${e.stack}`, 'error');
    return { bearerToken: null, csrfToken: null, transactionId: null };
  }
}

// Generate a pseudo x-client-transaction-id (fallback, not used if real one available)
function generateTransactionId() {
  const arr = new Uint8Array(16);
  window.crypto.getRandomValues(arr);
  return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
}

/////////////////////////
// Main Profile Action //
/////////////////////////

async function fetchProfileTimeline(username) {
  log('FETCH', `Preparing to fetch timeline for @${username}`, 'info');
  const { bearerToken, csrfToken, searchTimelineQueryId } = await getAuthTokens();

  //////////////////////////////
  // Transaction ID Request Demo //
  //////////////////////////////

  /**
   * Request a transaction ID from the active Twitter/X tab via background.js relay.
   * Logs result to console and can be plugged into UI as needed.
   */
  function requestTransactionIdFromActiveTab() {
    log('TID', 'Requesting Transaction ID from active Twitter/X tab...', 'info');
    chrome.runtime.sendMessage({
      action: 'relayToActiveTab',
      payload: { action: 'generateTID' }
    }, (response) => {
      if (chrome.runtime.lastError) {
        log('TID', `Error relaying to background: ${chrome.runtime.lastError.message}`, 'error');
        return;
      }
      if (response && response.tid) {
        log('TID', `Transaction ID: ${response.tid}`, 'success');
        // You can now use response.tid in your UI or API calls
      } else {
        log('TID', `Failed to get TID: ${response && response.error}`, 'error');
      }
    });
  }

  // Demo: Request TID on panel load
  const transactionId = requestTransactionIdFromActiveTab();
  log('FETCH', `Tokens for fetch: Bearer: ${bearerToken ? bearerToken.slice(0,12)+'...' : 'none'}, CSRF: ${csrfToken ? csrfToken.slice(0,12)+'...' : 'none'}, TransactionId: ${transactionId ? transactionId.slice(0,12)+'...' : 'none'}, QueryId: ${searchTimelineQueryId || 'none'}`,'info');
  // Defensive: check for all required tokens and queryId
  if (!bearerToken || !csrfToken || !transactionId || !searchTimelineQueryId) {
    log('FETCH', `Missing required credentials. Bearer: ${!!bearerToken}, CSRF: ${!!csrfToken}, TransactionId: ${!!transactionId}, QueryId: ${!!searchTimelineQueryId}`,'error');
    log('FETCH', `States: Bearer: ${bearerToken}, CSRF: ${csrfToken}, TransactionId: ${transactionId}, QueryId: ${searchTimelineQueryId}`,'error');
    return;
  }
  // Compose API URL for user's timeline using the dynamic queryId
  // Major assumption: queryId is always correct and up to date (background.js keeps it fresh)
  const url = `https://x.com/i/api/graphql/${searchTimelineQueryId}/SearchTimeline?variables=${encodeURIComponent(JSON.stringify({rawQuery:`from:${username} min_faves:999`,count:20,querySource:'typed_query',product:'Top'}))}&features=%7B%22rweb_video_screen_enabled%22%3Afalse%2C%22profile_label_improvements_pcf_label_in_post_enabled%22%3Atrue%2C%22rweb_tipjar_consumption_enabled%22%3Atrue%2C%22verified_phone_label_enabled%22%3Afalse%2C%22creator_subscriptions_tweet_preview_api_enabled%22%3Atrue%2C%22responsive_web_graphql_timeline_navigation_enabled%22%3Atrue%2C%22responsive_web_graphql_skip_user_profile_image_extensions_enabled%22%3Afalse%2C%22premium_content_api_read_enabled%22%3Afalse%2C%22communities_web_enable_tweet_community_results_fetch%22%3Atrue%2C%22c9s_tweet_anatomy_moderator_badge_enabled%22%3Atrue%2C%22responsive_web_grok_analyze_button_fetch_trends_enabled%22%3Afalse%2C%22responsive_web_grok_analyze_post_followups_enabled%22%3Atrue%2C%22responsive_web_jetfuel_frame%22%3Afalse%2C%22responsive_web_grok_share_attachment_enabled%22%3Atrue%2C%22articles_preview_enabled%22%3Atrue%2C%22responsive_web_edit_tweet_api_enabled%22%3Atrue%2C%22graphql_is_translatable_rweb_tweet_is_translatable_enabled%22%3Atrue%2C%22view_counts_everywhere_api_enabled%22%3Atrue%2C%22longform_notetweets_consumption_enabled%22%3Atrue%2C%22responsive_web_twitter_article_tweet_consumption_enabled%22%3Atrue%2C%22tweet_awards_web_tipping_enabled%22%3Afalse%2C%22responsive_web_grok_show_grok_translated_post%22%3Afalse%2C%22responsive_web_grok_analysis_button_from_backend%22%3Atrue%2C%22creator_subscriptions_quote_tweet_preview_enabled%22%3Afalse%2C%22freedom_of_speech_not_reach_fetch_enabled%22%3Atrue%2C%22standardized_nudges_misinfo%22%3Atrue%2C%22tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled%22%3Atrue%2C%22longform_notetweets_rich_text_read_enabled%22%3Atrue%2C%22longform_notetweets_inline_media_enabled%22%3Atrue%2C%22responsive_web_grok_image_annotation_enabled%22%3Atrue%2C%22responsive_web_enhance_cards_enabled%22%3Afalse%7D`;

  log('FETCH', `Fetching timeline for @${username} from ${url}`, 'info');

  const header = {
    headers: {
      'accept': '*/*',
      'accept-language': 'en-US,en;q=0.9',
      'authorization': `Bearer ${bearerToken}`,
      'content-type': 'application/json',
      'priority': 'u=1, i',
      'x-client-transaction-id': transactionId,
      "sec-ch-ua": "\"Chromium\";v=\"136\", \"Google Chrome\";v=\"136\", \"Not.A/Brand\";v=\"99\"",
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": "\"macOS\"",
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-origin",
      'x-csrf-token': csrfToken,
      'x-twitter-active-user': 'yes',
      'x-twitter-auth-type': 'OAuth2Session',
      'x-twitter-client-language': 'en'
    },
    referrer: window.location.href,
    "referrer": "https://x.com/search?q=from%3Aaltryne%20min_faves%3A999&src=typed_query",
    referrerPolicy: 'strict-origin-when-cross-origin',
    body: null,
    method: 'GET',
    mode: 'cors',
    credentials: 'include'
  };

  try {
    const resp = await fetch(url, header);

    console.log(`
var abc = await fetch("${url}", ${JSON.stringify(header, null, 2)});

console.log('----1')
console.log(abc)
console.log('----1')
abc = await abc.text()
console.log('----2')
console.log(abc)    
`)

    log('FETCH', `Response status: ${resp.status}`, resp.ok ? 'success' : 'warn');
    if (!resp.ok) {
      const errText = await resp.text();
      log('FETCH', `Error response: ${errText}`, 'error');
      return;
    }
    const data = await resp.json();
    log('FETCH', `Fetched timeline for @${username} successfully!`, 'success');
    renderTweets(data);
    console.log('[FETCH][DATA]', data);
  } catch (e) {
    log('FETCH', `Failed to fetch timeline: ${e.message}`, 'error');
    log('FETCH', `Error stack: ${e.stack}`, 'error');
  }
}

/////////////////////////////
// Session/Page Change Hook //
/////////////////////////////

// Track last profile username to avoid duplicate fetches
let lastProfile = null;

function getProfileUsername() {
  // Path is /username
  const match = window.location.pathname.match(/^\/([A-Za-z0-9_]+)$/);
  return match ? match[1] : null;
}

async function maybeRunProfileFetch() {
  const url = await getActiveTabUrl();
  if (isProfilePageFromUrl(url)) {
    const username = getProfileUsernameFromUrl(url);
    if (username && username !== lastProfile) {
      log('SESSION', `Detected profile page for @${username} (url: ${url})`, 'info');
      lastProfile = username;
      fetchProfileTimeline(username);
    }
  } else {
    log('SESSION', `Not a profile page (url: ${url}). No fetch performed.`, 'info');
    lastProfile = null;
  }
}

// Listen for page changes (X.COM is a SPA, so listen for popstate and pushState)
window.addEventListener('popstate', maybeRunProfileFetch);
const origPushState = history.pushState;
history.pushState = function(...args) {
  origPushState.apply(this, args);
  maybeRunProfileFetch();
};

// Initial run
maybeRunProfileFetch();

//////////////////////
// Tweets UI Render //
//////////////////////

/**
 * Render tweets from the API response into the #tweets-container.
 * @param {object} data - The parsed response from the X.COM API
 */
function renderTweets(data) {
  log('UI', 'Rendering tweets...', 'info');
  const container = document.getElementById('tweets-container');
  if (!container) {
    log('UI', 'No #tweets-container found in DOM.', 'error');
    return;
  }
  // Clear previous
  container.innerHTML = '';
  try {
    // Defensive: traverse to entries array
    const entries = data?.search_by_raw_query?.search_timeline?.timeline?.instructions?.find(
      inst => inst.type === 'TimelineAddEntries'
    )?.entries || [];
    if (!entries.length) {
      container.innerHTML = '<div class="card">No tweets found.</div>';
      log('UI', 'No tweet entries found in API response.', 'warn');
      return;
    }
    // Only show TimelineTimelineItem entries with tweet content
    const tweetCards = entries
      .filter(e => e.content?.entryType === 'TimelineTimelineItem')
      .map(e => {
        const tweet = e.content?.itemContent?.tweet_results?.result;
        if (!tweet) return '';
        // User
        const user = tweet.core?.user_results?.result;
        // Legacy tweet info
        const legacy = tweet.legacy || {};
        // Media (photo/video)
        const media = legacy.extended_entities?.media || [];
        // Format date
        const createdAt = legacy.created_at ? new Date(legacy.created_at).toLocaleString() : '';
        // Tweet text (basic linkify)
        let text = legacy.full_text || '';
        text = text.replace(/(https?:\/\/\S+)/g, '<a href="$1" target="_blank">$1</a>');
        // User info
        const profileImg = user?.legacy?.profile_image_url_https || '';
        const displayName = user?.legacy?.name || user?.screen_name || 'Unknown';
        const handle = user?.legacy?.screen_name || user?.screen_name || '';
        // Engagement
        const likes = legacy.favorite_count || 0;
        const retweets = legacy.retweet_count || 0;
        const replies = legacy.reply_count || 0;
        const views = tweet.views?.count || '';
        // Media thumbnails
        let mediaHtml = '';
        if (media.length) {
          mediaHtml = '<div class="tweet-media">' + media.map(m => {
            if (m.type === 'photo') {
              return `<img src="${m.media_url_https}" alt="media" style="max-width:100px;max-height:100px;border-radius:8px;margin:2px;"/>`;
            } else if (m.type === 'video' || m.type === 'animated_gif') {
              // Use video thumbnail
              return `<img src="${m.media_url_https}" alt="video" style="max-width:100px;max-height:100px;border-radius:8px;margin:2px;"/>`;
            }
            return '';
          }).join('') + '</div>';
        }
        // Build tweet card
        return `
          <div class="tweet-card card" style="margin-bottom:10px;">
            <div style="display:flex;align-items:center;gap:10px;">
              <img src="${profileImg}" alt="profile" style="width:40px;height:40px;border-radius:50%;border:1px solid #ccc;"/>
              <div>
                <span style="font-weight:bold;">${displayName}</span>
                <span style="color:#555;"> @${handle}</span><br/>
                <span style="font-size:11px;color:#999;">${createdAt}</span>
              </div>
            </div>
            <div style="margin-top:8px;margin-bottom:4px;line-height:1.4;">${text}</div>
            ${mediaHtml}
            <div style="margin-top:6px;font-size:12px;color:#555;">
              <span title="Likes">❤️ ${likes}</span> &nbsp;
              <span title="Retweets">🔁 ${retweets}</span> &nbsp;
              <span title="Replies">💬 ${replies}</span> &nbsp;
              <span title="Views">👁️ ${views}</span>
            </div>
          </div>
        `;
      }).join('');
    container.innerHTML = tweetCards;
    log('UI', `Rendered ${entries.length} entries.`, 'success');
  } catch (e) {
    container.innerHTML = '<div class="card" style="color:red;">Failed to render tweets.</div>';
    log('UI', `Failed to render tweets: ${e.message}`, 'error');
    log('UI', `Error stack: ${e.stack}`, 'error');
  }
}

//////////////////////////////
// Debug Button for Fetching //
//////////////////////////////

(function setupDebugFetchBtn() {
  const btn = document.getElementById('debug-fetch-btn');
  if (!btn) {
    log('DEBUG', 'No debug-fetch-btn found in DOM.', 'warn');
    return;
  }
  btn.addEventListener('click', async () => {
    log('DEBUG', 'Debug fetch button clicked.', 'info');
    const url = await getActiveTabUrl();
    if (!isProfilePageFromUrl(url)) {
      log('DEBUG', `Not on a profile page (url: ${url}). Fetch not triggered.`, 'warn');
      alert('Not on a profile page!');
      return;
    }
    const username = getProfileUsernameFromUrl(url);
    if (!username) {
      log('DEBUG', `Could not extract username from URL: ${url}`, 'error');
      alert('Could not extract username from URL!');
      return;
    }
    log('DEBUG', `Manually triggering fetchProfileTimeline for @${username} (url: ${url})`, 'info');
    fetchProfileTimeline(username);
  });
})();

//////////////////////////////
// Transaction ID Request Demo //
//////////////////////////////

/**
 * Request a transaction ID from the active Twitter/X tab via background.js relay.
 * Logs result to console and can be plugged into UI as needed.
 */
function requestTransactionIdFromActiveTab() {
  log('TID', 'Requesting Transaction ID from active Twitter/X tab...', 'info');
  chrome.runtime.sendMessage({
    action: 'relayToActiveTab',
    payload: { action: 'generateTID' }
  }, (response) => {
    if (chrome.runtime.lastError) {
      log('TID', `Error relaying to background: ${chrome.runtime.lastError.message}`, 'error');
      return;
    }
    if (response && response.tid) {
      log('TID', `Transaction ID: ${response.tid}`, 'success');
      // You can now use response.tid in your UI or API calls
    } else {
      log('TID', `Failed to get TID: ${response && response.error}`, 'error');
    }
  });
}

// Demo: Request TID on panel load
requestTransactionIdFromActiveTab();

// [INFO][END] index.js loaded and monitoring for profile page changes.
