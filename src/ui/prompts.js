// Text input
await Prompt.input({ message: 'Enter name:', default: 'John' });

// Password (masked)
await Prompt.password({ message: 'Enter password:' });

// Yes/No confirmation
await Prompt.confirm({ message: 'Continue?', default: true });

// Number with validation
await Prompt.number({ message: 'Port:', min: 1024, max: 65535, default: 8080 });

// Single select (arrow keys)
await Prompt.select({
  message: 'Choose browser:',
  choices: [
    { name: 'Chrome', value: 'chrome' },
    { name: 'Firefox', value: 'firefox' },
  ]
});

// Multi-select (checkboxes)
await Prompt.multiSelect({
  message: 'Select categories:',
  choices: ['news', 'shopping', 'tech', 'social'],
  min: 1
});

// Autocomplete with filtering
await Prompt.autocomplete({
  message: 'Search site:',
  choices: allSites
});
