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


// Get CSRF token from cookies
function getCsrfToken() {
  log('CSRF', 'Attempting to retrieve CSRF token from cookies...', 'info');
  const match = document.cookie.match(/(?:^|; )ct0=([^;]*)/);
  if (match) {
    log('CSRF', `CSRF token found: ${match[1]}`, 'success');
    return match[1];
  }
  log('CSRF', 'CSRF token NOT found in cookies.', 'warn');
  return null;
}

// Get Bearer token from localStorage (X.COM stores it here for web)
function getBearerToken() {
  log('AUTH', 'Attempting to retrieve Bearer token from localStorage...', 'info');
  // Try common keys used by Twitter/X web
  const keys = ['access_token', 'auth_token', 'BearerToken'];
  for (const key of keys) {
    const val = window.localStorage.getItem(key);
    if (val && val.startsWith('AAAA')) { // Twitter Bearer tokens start with 'AAAA...'
      log('AUTH', `Bearer token found in localStorage key: ${key}`, 'success');
      return val;
    }
  }
  // Fallback: Try to extract from any key that looks like a Bearer token
  for (const key of Object.keys(window.localStorage)) {
    const val = window.localStorage.getItem(key);
    if (val && val.startsWith('AAAA')) {
      log('AUTH', `Bearer token found in localStorage key: ${key} (fallback)`, 'success');
      return val;
    }
  }
  log('AUTH', 'Bearer token NOT found in localStorage.', 'error');
  return null;
}

// Generate a pseudo x-client-transaction-id (since real ones are per-request)
function generateTransactionId() {
  // Not cryptographically secure, but sufficient for X.COM API
  const arr = new Uint8Array(16);
  window.crypto.getRandomValues(arr);
  return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
}

/////////////////////////
// Main Profile Action //
/////////////////////////

async function fetchProfileTimeline(username) {
  log('FETCH', `Preparing to fetch timeline for @${username}`, 'info');
  const bearer = getBearerToken();
  const csrf = getCsrfToken();
  const transactionId = generateTransactionId();
  if (!bearer || !csrf) {
    log('FETCH', `Missing tokens. Bearer: ${!!bearer}, CSRF: ${!!csrf}`, 'error');
    return;
  }
  // Compose API URL for user's timeline
  const url = `https://x.com/i/api/graphql/nKAncKPF1fV1xltvF3UUlw/SearchTimeline?variables=${encodeURIComponent(JSON.stringify({rawQuery:`from:${username} min_faves:999`,count:20,querySource:'typed_query',product:'Top'}))}&features=${encodeURIComponent(JSON.stringify({rweb_video_screen_enabled:false,profile_label_improvements_pcf_label_in_post_enabled:true,rweb_tipjar_consumption_enabled:true,verified_phone_label_enabled:false,creator_subscriptions_tweet_preview_api_enabled:true,responsive_web_graphql_timeline_navigation_enabled:true,responsive_web_graphql_skip_user_profile_image_extensions_enabled:false,premium_content_api_read_enabled:false,communities_web_enable_tweet_community_results_fetch:true,c9s_tweet_anatomy_moderator_badge_enabled:true,responsive_web_grok_analyze_button_fetch_trends_enabled:false,responsive_web_grok_analyze_post_followups_enabled:true,responsive_web_jetfuel_frame:false,responsive_web_grok_share_attachment_enabled:true,articles_preview_enabled:true,responsive_web_edit_tweet_api_enabled:true,graphql_is_translatable_rweb_tweet_is_translatable_enabled:true,view_counts_everywhere_api_enabled:true,longform_notetweets_consumption_enabled:true,responsive_web_twitter_article_tweet_consumption_enabled:true,tweet_awards_web_tipping_enabled:false,responsive_web_grok_show_grok_translated_post:false,responsive_web_grok_analysis_button_from_backend:true,creator_subscriptions_quote_tweet_preview_enabled:false,freedom_of_speech_not_reach_fetch_enabled:true,standardized_nudges_misinfo:true,tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled:true,longform_notetweets_rich_text_read_enabled:true,longform_notetweets_inline_media_enabled:true,responsive_web_grok_image_annotation_enabled:true,responsive_web_enhance_cards_enabled:false}))}`;

  log('FETCH', `Fetching timeline for @${username} from ${url}`, 'info');

  try {
    const resp = await fetch(url, {
      headers: {
        'accept': '*/*',
        'accept-language': 'en-US,en;q=0.9',
        'authorization': `Bearer ${bearer}`,
        'content-type': 'application/json',
        'priority': 'u=1, i',
        'x-client-transaction-id': transactionId,
        'x-csrf-token': csrf,
        'x-twitter-active-user': 'yes',
        'x-twitter-auth-type': 'OAuth2Session',
        'x-twitter-client-language': 'en'
      },
      referrer: window.location.href,
      referrerPolicy: 'strict-origin-when-cross-origin',
      method: 'GET',
      mode: 'cors',
      credentials: 'include'
    });
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

// [INFO][END] index.js loaded and monitoring for profile page changes.
