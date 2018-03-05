browser.runtime.onConnect.addListener(port => {
  function listener(details) {
    if (details.tabId === port.sender.tab.id) {
      port.postMessage({event: 'pageChange'});
    }
  }
  browser.webNavigation.onHistoryStateUpdated.addListener(listener, {
    url: [
      {
        schemes: ['https'],
        hostEquals: 'sentry.prod.mozaws.net',
        pathPrefix: '/operations/nightly-js-errors/issues/',
      },
    ],
  });

  port.onDisconnect.addListener(() => {
    browser.webNavigation.onHistoryStateUpdated.removeListener(listener);
  });
});
