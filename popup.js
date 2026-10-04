document.addEventListener('DOMContentLoaded', () => {
  const toggle = document.getElementById('toggle');

  chrome.storage.sync.get({ pbfEnabled: true }, (res) => {
    toggle.checked = res.pbfEnabled;
  });

  toggle.addEventListener('change', () => {
    chrome.storage.sync.set({ pbfEnabled: toggle.checked });
  });
});
