/* eslint-disable @typescript-eslint/no-require-imports -- Source-loader UI regression. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { sourceLoader } = require('./helpers/source-loader.cjs');
const { AccountSearchSelect } = sourceLoader()('src/components/AccountSearchSelect.tsx');
const option = (value, label) => React.createElement('option', { value, key: value }, label);

test('account search displays code/name and retains original ID/code form contract', () => {
  for (const key of ['2710', 'company:fixture-id']) {
    const html = renderToStaticMarkup(React.createElement(AccountSearchSelect, {
      name: 'konto', defaultValue: key, required: true
    }, option('', 'Izaberite konto'), React.createElement(React.Fragment, {}, option(key, '2710 — Ulazni PDV'))));
    assert.match(html, /role="combobox"/);
    assert.match(html, /value="2710 — Ulazni PDV"/);
    assert.match(html, new RegExp(`<option value="${key}" selected=""`));
    assert.match(html, /<select[^>]*name="konto"/);
    assert.doesNotMatch(html, /<input[^>]*name="konto"/);
    assert.match(html, /<input[^>]*required=""/);
  }
});
test('optional filters and disabled account selectors retain their existing semantics', () => {
  const filter = renderToStaticMarkup(React.createElement(AccountSearchSelect, { name: 'konto', defaultValue: 'ALL' }, option('ALL', 'Sva konta'), option('2710', '2710 — PDV')));
  assert.match(filter, /value="Sva konta"/);
  assert.match(filter, /<option value="ALL" selected=""/);
  const disabled = renderToStaticMarkup(React.createElement(AccountSearchSelect, { name: 'konto', disabled: true }, option('', '-')));
  assert.match(disabled, /<input[^>]*disabled=""/);
  assert.match(disabled, /<select[^>]*disabled=""/);
});
