const ISSUE_URL_REGEX = (
  /^https:\/\/sentry.prod.mozaws.net\/operations\/nightly-js-errors\/issues\/([0-9]+)\/(?:events\/([0-9]+)\/)?/
);

async function waitForElement(selector) {
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

async function modifyPage() {
  const match = window.location.href.match(ISSUE_URL_REGEX);
  if (!match) {
    return;
  }

  const issueId = match[1];
  const eventId = match[2];

  const buttons = document.querySelectorAll('.btn-bugzilla');
  if (buttons.length > 0) {
    for (const button of buttons) {
      button.href = await createBugzillaUrl(issueId, eventId);
    }
  } else {
    const groupActions = await waitForElement('.group-actions');
    const button = await createBugzillaButton(issueId, eventId);
    groupActions.appendChild(button);
  }
}

async function createBugzillaButton(issueId, eventId) {
  const button = document.createElement('a');
  button.className = 'btn btn-default btn-sm btn-bugzilla';
  button.style.marginLeft = '5px';
  button.href = await createBugzillaUrl(issueId, eventId);

  const buttonIcon = document.createElement('img');
  buttonIcon.src = browser.extension.getURL('bugzilla.png');
  buttonIcon.style.verticalAlign = 'top';

  const buttonText = document.createElement('span');
  buttonText.textContent = 'File Bugzilla Bug'
  buttonText.style.marginLeft = '5px';

  button.appendChild(buttonIcon);
  button.appendChild(buttonText);

  return button;
}

let issue = null;
async function createBugzillaUrl(issueId, eventId) {
  const issueUrl = `https://sentry.prod.mozaws.net/operations/nightly-js-errors/issues/${issueId}/`;

  if (!issue) {
    const issueResponse = await fetch(`https://sentry.prod.mozaws.net/api/0/issues/${issueId}/`, {
      credentials: 'same-origin',
    });
    issue = await issueResponse.json();
  }

  let urlEventId = eventId;
  if (!urlEventId) {
    urlEventId = 'latest';
  }
  const eventResponse = await fetch(
    `https://sentry.prod.mozaws.net/operations/nightly-js-errors/issues/${issueId}/events/${urlEventId}/json/`,
    {
        credentials: 'same-origin',
    },
  );
  const event = await eventResponse.json();

  let commentUrl = issueUrl;
  if (eventId) {
    commentUrl = `${issueUrl}events/${eventId}/`;
  }
  let comment = `This bug was automatically filed from Sentry: ${commentUrl}\n\n`;

  const exception = event["sentry.interfaces.Exception"];
  if (exception) {
    const exceptionValue = exception.values[0];
    comment += `${exceptionValue.type}: ${exceptionValue.value}`;
    const stacktrace = exceptionValue.stacktrace;
    if (stacktrace) {
      stacktrace.frames.reverse();
      for (const frame of stacktrace.frames) {
        comment += `\n    at ${frame.function}(${frame.filename}:${frame.lineno}:${frame.colno})`;
      }
    }
  } else {
    comment += event.message;
  }

  const whiteboardTags = {
    'nightly-js-sentry': issueId,
  }

  const url = new URL('https://bugzilla.mozilla.org/enter_bug.cgi');
  const params = {
    short_desc: issue.title,
    comment,
    component: 'General',
    product: 'Firefox',
    version: 'Trunk',
    status_whiteboard: Object.entries(whiteboardTags).map(([key, value]) => `[${key}:${value}]`).join(''),
    bug_file_loc: issueUrl,
  }
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  return url.href;
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
