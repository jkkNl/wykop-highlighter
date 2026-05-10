// ==UserScript==
// @name         wykop-highligher
// @namespace    https://wykop.pl/
// @version      0.1
// @description  This tool adds colored borders to posts on the Wykop.pl portal and changes the background color of posts with selected tags.
// @author       Filip Szulik-Szarecki
// @match        https://wykop.pl/
// @match        https://wykop.pl/strona/*
// @run-at       document-idle
// @grant        GM_getResourceText
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @connect      *
// @resource     wykopDomainList https://raw.githubusercontent.com/jkkNl/wykop-highlighter/main/list.txt
// ==/UserScript==

(function () {
  'use strict';

  const DOMAIN_LIST_URL = 'https://raw.githubusercontent.com/jkkNl/wykop-highlighter/main/list.txt';
  const RESOURCE_NAME = 'wykopDomainList';
  const PAGE_PATH_RE = /^\/(?:|strona\/\d+\/?)$/;
  const BLOCK_SELECTOR = 'section.link-block[id^="link-"]';
  const DOMAIN_SELECTOR = '.info a.external';
  const TAG_SELECTOR = 'li.tag a[href*="/tag/"]';
  const MARK_CLASS = 'wykop-domain-highlight';
  const TAG_MARK_CLASS = 'wykop-tag-highlight';
  const BADGE_CLASS = 'wykop-domain-highlight__badge';
  const STYLE_ID = 'wykop-domain-highlight-style';

  let domainRules = [];
  let tagRules = [];
  let refreshTimer = null;
  let observer = null;

  if (!PAGE_PATH_RE.test(window.location.pathname)) {
    return;
  }

  injectStyles();
  registerMenu();

  void refreshDomainRules();
  startObserver();

  function registerMenu() {
    if (typeof GM_registerMenuCommand !== 'function') {
      return;
    }

    GM_registerMenuCommand('Wykop: przeładuj listę domen', () => {
      void refreshDomainRules(true);
    });
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) {
      return;
    }

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      ${BLOCK_SELECTOR}.${MARK_CLASS} {
        position: relative;
        border-radius: 16px;
      }

      ${BLOCK_SELECTOR}.${MARK_CLASS}::before {
        content: '';
        position: absolute;
        inset: -3px;
        border: 6px solid var(--wykop-domain-accent) !important;
        border-radius: 19px;
        pointer-events: none;
        z-index: 3;
        box-sizing: border-box;
      }

      ${BLOCK_SELECTOR}.${MARK_CLASS},
      ${BLOCK_SELECTOR}.${TAG_MARK_CLASS} {
        background: var(--wykop-tag-fill, transparent) !important;
      }

      ${BLOCK_SELECTOR}.${MARK_CLASS}:hover,
      ${BLOCK_SELECTOR}.${MARK_CLASS}:focus-within {
        border-radius: 16px;
        background: var(--wykop-tag-fill, transparent) !important;
      }

      ${BLOCK_SELECTOR}.${TAG_MARK_CLASS} {
        position: relative;
        border-radius: 16px;
      }

      ${BLOCK_SELECTOR}.${TAG_MARK_CLASS}:hover,
      ${BLOCK_SELECTOR}.${TAG_MARK_CLASS}:focus-within {
        background: var(--wykop-tag-fill, transparent) !important;
      }

      ${BLOCK_SELECTOR}.${MARK_CLASS} article {
        position: relative;
        z-index: 4;
      }

      ${BLOCK_SELECTOR}.${MARK_CLASS} .heading a {
        text-decoration-line: underline;
        text-decoration-thickness: 2px;
        text-decoration-color: var(--wykop-domain-accent);
      }

      .${BADGE_CLASS} {
        position: absolute;
        top: 10px;
        right: 10px;
        z-index: 5;
        max-width: min(48%, 220px);
        padding: 4px 10px;
        border-radius: 999px;
        font-size: 12px;
        font-weight: 800;
        letter-spacing: 0.02em;
        color: #ffffff;
        background: var(--wykop-domain-accent);
        box-shadow: 0 10px 24px rgba(0, 0, 0, 0.2);
        pointer-events: none;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
    `;

    document.head.appendChild(style);
  }

  function startObserver() {
    observer = new MutationObserver(() => {
      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        applyHighlights();
      }, 120);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  async function refreshDomainRules(verbose = false) {
    try {
      const rules = await loadRules();
      domainRules = rules.domainRules;
      tagRules = rules.tagRules;
      applyHighlights();

      if (verbose) {
        console.info(
          `[Wykop źródła] Załadowano ${domainRules.length} domen i ${tagRules.length} tagów z pliku ${DOMAIN_LIST_URL}.`
        );
      }
    } catch (error) {
      console.error('[Wykop źródła] Nie udało się wczytać listy domen.', error);
    }
  }

  async function loadRules() {
    const errors = [];
    let text = '';

    if (typeof GM_xmlhttpRequest === 'function') {
      try {
        text = await loadTextViaUserscriptRequest(DOMAIN_LIST_URL);
      } catch (error) {
        errors.push(error);
      }
    }

    if (!text && typeof GM_getResourceText === 'function') {
      try {
        text = GM_getResourceText(RESOURCE_NAME) || '';
      } catch (error) {
        errors.push(error);
      }
    }

    const rules = parseRules(text);
    if (rules.domainRules.length > 0 || rules.tagRules.length > 0) {
      return rules;
    }

    if (errors.length > 0) {
      throw errors[0];
    }

    return {
      domainRules: [],
      tagRules: [],
    };
  }

  function loadTextViaUserscriptRequest(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        nocache: true,
        onload(response) {
          const okStatus =
            response.status === 0 ||
            (response.status >= 200 && response.status < 400);

          if (okStatus && typeof response.responseText === 'string') {
            resolve(response.responseText);
            return;
          }

          reject(
            new Error(
              `Nieprawidłowa odpowiedź podczas wczytywania listy domen: ${response.status}`
            )
          );
        },
        onerror(error) {
          reject(error);
        },
      });
    });
  }

  function parseRules(text) {
    const parsedRules = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && !line.startsWith('//'))
      .map((line) => {
        const separator = line.includes('=') ? '=' : line.includes('|') ? '|' : null;
        const parts = separator ? line.split(separator, 2) : [line];
        const rawKey = (parts[0] || '').trim();
        const color = (parts[1] || '').trim();
        const prefixedMatch = rawKey.match(/^(domain|tag)\s*:\s*(.+)$/i);

        if (prefixedMatch) {
          const ruleType = prefixedMatch[1].toLowerCase();
          const ruleValue = prefixedMatch[2].trim();

          if (ruleType === 'tag') {
            const tag = normalizeTag(ruleValue);
            if (!tag) {
              return null;
            }

            return {
              type: 'tag',
              tag,
              color: color || colorFromTag(tag),
            };
          }

          const domain = normalizeDomain(ruleValue);
          if (!domain) {
            return null;
          }

          return {
            type: 'domain',
            domain,
            color: color || colorFromDomain(domain),
          };
        }

        const domain = normalizeDomain(rawKey);
        if (!domain) {
          return null;
        }

        return {
          type: 'domain',
          domain,
          color: color || colorFromDomain(domain),
        };
      })
      .filter(Boolean);

    return {
      domainRules: parsedRules
        .filter((rule) => rule.type === 'domain')
        .sort((left, right) => right.domain.length - left.domain.length),
      tagRules: parsedRules.filter((rule) => rule.type === 'tag'),
    };
  }

  function normalizeDomain(rawValue) {
    if (!rawValue) {
      return null;
    }

    let value = rawValue.trim().toLowerCase();
    if (!value) {
      return null;
    }

    value = value.replace(/^https?:\/\//, '');
    value = value.replace(/^www\./, '');
    value = value.split(/[/?#]/, 1)[0];
    value = value.replace(/:\d+$/, '');
    value = value.replace(/\.+$/, '');

    return value || null;
  }

  function colorFromDomain(domain) {
    let hash = 0;
    for (const char of domain) {
      hash = (hash << 5) - hash + char.charCodeAt(0);
      hash |= 0;
    }

    const hue = Math.abs(hash) % 360;
    return `hsl(${hue} 72% 42%)`;
  }

  function normalizeTag(rawValue) {
    if (!rawValue) {
      return null;
    }

    const value = rawValue.trim().toLowerCase().replace(/^#/, '');
    return value || null;
  }

  function colorFromTag(tag) {
    let hash = 0;
    for (const char of tag) {
      hash = (hash << 5) - hash + char.charCodeAt(0);
      hash |= 0;
    }

    const hue = Math.abs(hash) % 360;
    return `hsla(${hue} 70% 50% / 0.14)`;
  }

  function applyHighlights() {
    const blocks = document.querySelectorAll(BLOCK_SELECTOR);

    for (const block of blocks) {
      clearHighlight(block);

      const tagRule = findMatchingTagRule(block);
      if (tagRule) {
        block.classList.add(TAG_MARK_CLASS);
        block.style.setProperty('--wykop-tag-fill', tagRule.color);
      }

      const normalizedDomain = getSourceDomain(block);
      if (!normalizedDomain) {
        continue;
      }

      const matchingRule = findMatchingRule(normalizedDomain);
      if (!matchingRule) {
        continue;
      }

      block.classList.add(MARK_CLASS);
      block.style.setProperty('--wykop-domain-accent', matchingRule.color);

      const article = block.querySelector('article');
      if (!article) {
        continue;
      }

      const badge = document.createElement('span');
      badge.className = BADGE_CLASS;
      badge.textContent = matchingRule.domain;
      article.appendChild(badge);
    }
  }

  function clearHighlight(block) {
    block.classList.remove(MARK_CLASS);
    block.classList.remove(TAG_MARK_CLASS);
    block.style.removeProperty('--wykop-domain-accent');
    block.style.removeProperty('--wykop-tag-fill');

    const badge = block.querySelector(`.${BADGE_CLASS}`);
    if (badge) {
      badge.remove();
    }
  }

  function findMatchingRule(domain) {
    return (
      domainRules.find((rule) => domain === rule.domain || domain.endsWith(`.${rule.domain}`)) ||
      null
    );
  }

  function getSourceDomain(block) {
    const domainAnchor = block.querySelector(DOMAIN_SELECTOR);
    if (!domainAnchor) {
      return null;
    }

    const href = domainAnchor.getAttribute('href') || '';
    if (href) {
      try {
        const url = new URL(href, window.location.origin);
        const domainsParam = url.searchParams.get('domains');
        if (domainsParam) {
          return normalizeDomain(domainsParam);
        }

        if (url.hostname && url.hostname !== 'wykop.pl' && !url.hostname.endsWith('.wykop.pl')) {
          return normalizeDomain(url.hostname);
        }
      } catch (_error) {
        // Fallback do tekstu linku poniżej.
      }
    }

    return normalizeDomain(domainAnchor.textContent || '');
  }

  function findMatchingTagRule(block) {
    const tagAnchors = block.querySelectorAll(TAG_SELECTOR);
    for (const anchor of tagAnchors) {
      const normalizedTag = normalizeTag(anchor.textContent || '');
      if (!normalizedTag) {
        continue;
      }

      const matchingRule = tagRules.find((rule) => rule.tag === normalizedTag);
      if (matchingRule) {
        return matchingRule;
      }
    }

    return null;
  }
})();
