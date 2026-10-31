// Some Windows Edge runtimes retain a Playwright transport handle after the
// isolated browser has disconnected. Bound teardown, require disconnection,
// then let the completed CLI exit without waiting on that runtime handle.
async function closeCheckedBrowser(browser) {
  let timer;
  try {
    await Promise.race([browser.close(), new Promise(resolve => { timer = setTimeout(resolve, 5000); })]);
    if (browser.isConnected()) throw Error('QA browser did not disconnect during teardown');
  } finally { clearTimeout(timer); }
}
module.exports = { closeCheckedBrowser };
