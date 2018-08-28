const ISSUE_URL_REGEX = (
  /^https:\/\/sentry.prod.mozaws.net\/operations\/nightly-js-errors\/issues\/([0-9]+)\/(?:events\/([0-9]+)\/)?/
);

const PRODUCT_COMPONENTS = [
  ['Firefox', 'General'],
  ['Toolkit', 'General'],
  ['DevTools', 'General'],
  ['Tech Evangelism', 'Add-ons'],
];

const sentry = {
  issueCache: new Map(),
  eventCache: new Map(),

  async _get(url) {
    try {
      const response = await fetch(url, {credentials: 'same-origin'});
      if (response.ok) {
        return response.json();
      }
    } catch (err) {
      console.error(err);
    }
  },

  async getIssue(issueId) {
    if (!this.issueCache.has(issueId)) {
      const issue = await this._get(`https://sentry.prod.mozaws.net/api/0/issues/${issueId}/`);
      if (issue) {
        this.issueCache.set(issueId, issue);
      }
    }
    return this.issueCache.get(issueId);
  },

  async getEvent(issueId, eventId='latest') {
    const key = `${issueId}:${eventId}`;
    if (!this.eventCache.has(key)) {
      const url = (
        `https://sentry.prod.mozaws.net/operations/nightly-js-errors/issues/` +
        `${issueId}/events/${eventId}/json/`
      );
      const event = await this._get(url);
      if (event) {
        this.eventCache.set(key, event);
      }
    }
    return this.eventCache.get(key);
  },
};

const bugzilla = {
  bugCache: new Map(),

  async _get(url) {
    try {
      const response = await fetch(url, {headers: {Accept: 'application/json'}});
      if (response.ok) {
        return response.json();
      }
    } catch (err) {
      console.error(err);
    }
  },

  async getBugsForIssue(issueId) {
      const url = new URL('https://bugzilla.mozilla.org/rest/bug');
      url.searchParams.set('whiteboard', `[nightly-js-sentry:${issueId}]`);

      if (!this.bugCache.has(issueId)) {
        const data = await this._get(url.href);
        if (data) {
          this.bugCache.set(issueId, data.bugs);
        }
      }

      return this.bugCache.get(issueId) || [];
  },

  getBugUrl(bugId) {
    const url = new URL('https://bugzilla.mozilla.org/show_bug.cgi');
    url.searchParams.set('id', bugId);
    return url.href;
  },

  getSearchUrl(params={}) {
    const url = new URL('https://bugzilla.mozilla.org/buglist.cgi');
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
    return url.href;
  },

  async getNewBugUrl(issueId, eventId, product, component) {
    const issue = await sentry.getIssue(issueId);
    const event = await sentry.getEvent(issueId, eventId);

    let commentUrl = `https://sentry.prod.mozaws.net/operations/nightly-js-errors/issues/${issueId}/`;
    if (eventId) {
      commentUrl += `events/${eventId}/`;
    }

    let comment = `This bug was automatically filed from Sentry: ${commentUrl}\n\n`;

    if (event) {
      const exception = event["sentry.interfaces.Exception"];
      if (exception) {
        const exceptionValue = exception.values[0];
        comment += `${exceptionValue.type}: ${exceptionValue.value}`;
        const stacktrace = exceptionValue.stacktrace;
        if (stacktrace) {
          stacktrace.frames.reverse();
          for (const frame of stacktrace.frames) {
            comment += `\n    at ${frame.function}(${frame.module}:${frame.lineno}:${frame.colno})`;
          }
        }
      } else {
        comment += event.message;
      }
    }

    const whiteboardTags = {
      'nightly-js-sentry': issueId,
    };

    const url = new URL('https://bugzilla.mozilla.org/enter_bug.cgi');
    const params = {
      short_desc: issue ? issue.title : '',
      comment,
      component,
      product,
      version: 'Trunk',
      status_whiteboard: Object.entries(whiteboardTags).map(([key, value]) => `[${key}:${value}]`).join(''),
      bug_file_loc: commentUrl,
    };
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }

    return url.href;
  },
};

async function waitForElement(selector) {
  const element = document.querySelector(selector);
  if (element) {
    return element;
  }

  return new Promise(resolve => {
    const observer = new MutationObserver(() => {
      const element = document.querySelector(selector);
      if (element) {
        observer.disconnect();
        resolve(element);
      }
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  });
}

let currentIssueId = null;
let currentButtonWrapper = null;
async function modifyPage() {
  const match = window.location.href.match(ISSUE_URL_REGEX);
  if (!match) {
    return;
  }

  const issueId = match[1];
  const eventId = match[2];

  // If moving to a new issue page, create the button for the first time.
  if (issueId !== currentIssueId) {
    const groupActions = await waitForElement('.group-actions');
    currentButtonWrapper = document.createElement('span');
    groupActions.appendChild(currentButtonWrapper);
  }

  const bugs = await bugzilla.getBugsForIssue(issueId);
  if (currentButtonWrapper.lastChild) {
    currentButtonWrapper.lastChild.remove();
  }
  if (bugs.length === 1) {
    currentButtonWrapper.appendChild(await createViewBugButton(bugs[0].id));
  } else if (bugs.length > 1) {
    currentButtonWrapper.appendChild(await createBugSearchButton({
      status_whiteboard: `[nightly-js-sentry:${issueId}]`,
    }));
  } else {
    currentButtonWrapper.appendChild(await createNewBugButton(issueId, eventId));
  }

  currentIssueId = issueId;
}

async function createViewBugButton(bugId) {
  const button = document.createElement('a');
  button.className = 'btn btn-default btn-sm btn-bugzilla';
  button.style.marginLeft = '5px';
  button.href = await bugzilla.getBugUrl(bugId);

  const buttonIcon = document.createElement('img');
  buttonIcon.src = browser.extension.getURL('bugzilla.png');
  buttonIcon.style.verticalAlign = 'top';

  const buttonText = document.createElement('span');
  buttonText.className = 'button-text';
  buttonText.textContent = 'View Bugzilla Bug';
  buttonText.style.marginLeft = '5px';

  button.appendChild(buttonIcon);
  button.appendChild(buttonText);

  return button;
}

async function createBugSearchButton(params) {
  const button = document.createElement('a');
  button.className = 'btn btn-default btn-sm btn-bugzilla';
  button.style.marginLeft = '5px';
  button.href = bugzilla.getSearchUrl(params);

  const buttonIcon = document.createElement('img');
  buttonIcon.src = browser.extension.getURL('bugzilla.png');
  buttonIcon.style.verticalAlign = 'top';

  const buttonText = document.createElement('span');
  buttonText.className = 'button-text';
  buttonText.textContent = 'View Bugzilla Bugs';
  buttonText.style.marginLeft = '5px';

  button.appendChild(buttonIcon);
  button.appendChild(buttonText);

  return button;
}

async function createNewBugButton(issueId, eventId) {
  const wrapperSpan = document.createElement('span');
  wrapperSpan.className = 'dropdown';

  const button = document.createElement('a');
  button.className = 'btn btn-default btn-sm btn-bugzilla';
  button.style.marginLeft = '5px';
  button.addEventListener('click', () => {
    wrapperSpan.classList.toggle('open');
  });

  const buttonIcon = document.createElement('img');
  buttonIcon.src = browser.extension.getURL('bugzilla.png');
  buttonIcon.style.verticalAlign = 'top';

  const buttonText = document.createElement('span');
  buttonText.className = 'button-text';
  buttonText.textContent = 'File Bugzilla Bug';
  buttonText.style.marginLeft = '5px';

  const buttonArrow = document.createElement('span');
  buttonArrow.className = 'icon-arrow-down';

  button.appendChild(buttonIcon);
  button.appendChild(buttonText);
  button.appendChild(buttonArrow);
  wrapperSpan.appendChild(button);

  const dropdownMenu = document.createElement('ul');
  dropdownMenu.className = 'dropdown-menu';

  const dropdownHeader = document.createElement('li');
  dropdownHeader.className = 'dropdown-header';
  dropdownHeader.textContent = 'File in Product::Component';
  dropdownMenu.appendChild(dropdownHeader);

  for (const [product, component] of PRODUCT_COMPONENTS) {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.textContent = `${product}::${component}`;
    a.href = await bugzilla.getNewBugUrl(issueId, eventId, product, component);
    li.appendChild(a);
    dropdownMenu.appendChild(li);
  }

  wrapperSpan.appendChild(dropdownMenu);

  return wrapperSpan;
}

const port = browser.runtime.connect();
port.onMessage.addListener(message => {
  if (message.event === 'pageChange') {
    modifyPage();
  }
});

// Modify the page once on initialization since the onMessage won't be sent on
// initial load.
modifyPage();
