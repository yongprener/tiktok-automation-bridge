/**
 * Content Script
 * 
 * Runs on every page. Listens for commands from background.js
 * and executes DOM interactions: scrape, click, fill, navigate, wait.
 */

// ─── Message Listener ─────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== 'execute') return;
  
  const command = message.command || '';
  const parts = command.toLowerCase().split(/\s+/);
  const action = parts[0];
  
  (async () => {
    try {
      let result;
      
      switch (action) {
        case 'wait':
          result = await waitForElement(parts[1], parseInt(parts[2]) || 5000);
          break;
        
        case 'scroll':
          result = await scrollTo(parts[1] || 'bottom');
          break;
        
        case 'get_text':
          result = await getText(parts.slice(1).join(' '));
          break;
        
        case 'get_html':
          result = await getHtml(parts.slice(1).join(' '));
          break;
        
        case 'get_attrs':
          result = await getAttributes(parts[1]);
          break;
        
        case 'wait_for_text':
          result = await waitForText(parts.slice(1).join(' '), 10000);
          break;
        
        case 'count':
          result = await countElements(parts.slice(1).join(' '));
          break;
        
        case 'fill_form':
          result = await fillFormData(JSON.parse(parts.slice(1).join(' ')));
          break;
        
        default:
          result = { error: `Unknown action: ${action}` };
      }
      
      sendResponse({ success: true, result });
    } catch (error) {
      sendResponse({ success: false, error: error.message });
    }
  })();
  
  return true; // keep channel open for async
});

// ─── DOM Actions ──────────────────────────────────────────────────

function waitForSelector(selector, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const el = document.querySelector(selector);
    if (el) return resolve(el);
    
    const observer = new MutationObserver(() => {
      const el = document.querySelector(selector);
      if (el) {
        observer.disconnect();
        clearTimeout(timer);
        resolve(el);
      }
    });
    
    observer.observe(document.body, { childList: true, subtree: true });
    
    const timer = setTimeout(() => {
      observer.disconnect();
      reject(new Error(`Timeout waiting for ${selector}`));
    }, timeout);
  });
}

async function waitForElement(selector, timeout) {
  await waitForSelector(selector, timeout);
  return { found: true, selector };
}

async function scrollTo(position) {
  if (position === 'bottom') {
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
  } else if (position === 'top') {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } else {
    window.scrollTo({ top: parseInt(position) || 0, behavior: 'smooth' });
  }
  await new Promise(r => setTimeout(r, 1000));
  return { scrolled: position };
}

async function getText(selector) {
  const el = await waitForSelector(selector, 3000);
  return { text: el.textContent.trim().substring(0, 2000) };
}

async function getHtml(selector) {
  const el = await waitForSelector(selector, 3000);
  return { html: el.outerHTML.substring(0, 5000) };
}

async function getAttributes(selector) {
  const el = document.querySelector(selector);
  if (!el) return { error: 'Element not found' };
  
  const attrs = {};
  for (const attr of el.attributes) {
    attrs[attr.name] = attr.value;
  }
  return { attributes: attrs };
}

async function waitForText(text, timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (document.body.textContent.includes(text)) {
      return { found: true, text };
    }
    await new Promise(r => setTimeout(r, 500));
  }
  return { found: false, text };
}

async function countElements(selector) {
  return { count: document.querySelectorAll(selector).length };
}

async function fillFormData(data) {
  let filled = 0;
  for (const [selector, value] of Object.entries(data)) {
    const el = document.querySelector(selector);
    if (!el) continue;
    
    // Handle different input types
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      filled++;
    } else if (el.tagName === 'SELECT') {
      el.value = value;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      filled++;
    } else if (el.getAttribute('contenteditable') !== null) {
      el.textContent = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      filled++;
    }
  }
  return { filled, total: Object.keys(data).length };
}
