window.history.pushState = function(...args) {
  window.history.pushState(...args);
  (async function() {
    for (const button of document.querySelectorAll('.btn-bugzilla')) {
      button.href = await createBugzillaUrl();
    }
  })();
}

const ISSUE_URL_REGEX = (
  /^https:\/\/sentry\.prod\.mozaws\.net\/operations\/nightly-js-errors\/issues\/([0-9]+)\/(?:events\/([0-9]+)\/)?/
);

(async function() {
  const groupActions = await waitForElement('.group-actions');
  groupActions.appendChild(await createBugzillaButton());
})();

async function createBugzillaButton() {
  const button = document.createElement('a');
  button.className = 'btn btn-default btn-sm btn-bugzilla';
  button.style.marginLeft = '5px';
  button.href = await createBugzillaUrl();

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
async function createBugzillaUrl() {
  const currentUrl = window.location.href;
  let [_, issueId, eventId] = currentUrl.match(ISSUE_URL_REGEX);
  const issueUrl = `https://sentry.prod.mozaws.net/operations/nightly-js-errors/issues/${issueId}/`;

  if (!issue) {
    const issueResponse = await fetch(`https://sentry.prod.mozaws.net/api/0/issues/${issueId}/`, {
      credentials: 'same-origin',
    });
    issue = await issueResponse.json();
  }

  if (!eventId) {
    eventId = 'latest';
  }
  const eventResponse = await fetch(`https://sentry.prod.mozaws.net/api/0/issues/${issueId}/events/${eventId}/`, {
    credentials: 'same-origin',
  });
  const event = await eventResponse.json();

  let comment = `This bug was automatically filed from Sentry: ${issueUrl}\n\n${event.message}`;

  const exception = event.entries.find(entry => entry.type === 'exception');
  if (exception) {
    const frames = exception.data.values[0].stacktrace.frames;
    for (const frame of frames) {
      comment += `\n    at ${frame.function}(${frame.filename}:${frame.lineNo}:${frame.colNo})`;
    }
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
