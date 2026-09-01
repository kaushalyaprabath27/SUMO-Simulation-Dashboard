// Direct regression coverage for emissionsParser.js's parseXMLDocument() —
// the hand-rolled, dependency-free XML tokenizer/parser that replaced the
// original regex-based tripinfo extraction (see emissionsParser.js's header
// and CLAUDE.md's History section for why). These tests exercise the
// tokenizer itself, independent of the emissions-domain logic that consumes
// it (see tests/emissionsParser.test.js for that). Run with: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseXMLDocument } = require('../emissionsParser.js');

function findFirst(node, name) {
    if (node.name === name) return node;
    for (const child of node.children) {
        const found = findFirst(child, name);
        if (found) return found;
    }
    return null;
}

test('parses a simple well-formed document into the expected tree shape', () => {
    const { root, parserWarnings } = parseXMLDocument('<a x="1"><b y="2"/></a>');
    assert.equal(root.children.length, 1);
    const a = root.children[0];
    assert.equal(a.name, 'a');
    assert.equal(a.attrs.x, '1');
    assert.equal(a.children.length, 1);
    assert.equal(a.children[0].name, 'b');
    assert.equal(a.children[0].attrs.y, '2');
    assert.deepEqual(parserWarnings, []);
});

test('self-closing tags do not consume any following sibling as a child', () => {
    const { root } = parseXMLDocument('<root><a/><b/></root>');
    const rootEl = root.children[0];
    assert.equal(rootEl.children.length, 2);
    assert.equal(rootEl.children[0].name, 'a');
    assert.equal(rootEl.children[1].name, 'b');
});

test('single-quoted and double-quoted attribute values both parse correctly', () => {
    const { root } = parseXMLDocument(`<a foo='bar' baz="qux"/>`);
    const a = root.children[0];
    assert.equal(a.attrs.foo, 'bar');
    assert.equal(a.attrs.baz, 'qux');
});

test('comments are skipped and do not appear in the tree or disrupt sibling structure', () => {
    const { root } = parseXMLDocument('<root><!-- a comment with <fake> tags inside --><a/></root>');
    const rootEl = root.children[0];
    assert.equal(rootEl.children.length, 1);
    assert.equal(rootEl.children[0].name, 'a');
});

test('CDATA sections are skipped and do not disrupt sibling structure', () => {
    const { root } = parseXMLDocument('<root><![CDATA[ <not a tag> & weird stuff ]]><a/></root>');
    const rootEl = root.children[0];
    assert.equal(rootEl.children.length, 1);
    assert.equal(rootEl.children[0].name, 'a');
});

test('an XML declaration and a DOCTYPE-style declaration are both skipped', () => {
    const { root } = parseXMLDocument('<?xml version="1.0"?><!DOCTYPE root SYSTEM "x.dtd"><root/>');
    assert.equal(root.children.length, 1);
    assert.equal(root.children[0].name, 'root');
});

test('a leading BOM does not produce a stray text node or break parsing', () => {
    const { root } = parseXMLDocument('﻿<root><a/></root>');
    assert.equal(root.children.length, 1);
    assert.equal(root.children[0].name, 'root');
});

test('an unquoted attribute value is tolerated rather than getting the parser stuck', () => {
    const { root } = parseXMLDocument('<a foo=bar/>');
    assert.equal(root.children[0].attrs.foo, 'bar');
});

test('a closing tag with no matching open tag anywhere is ignored and reported, without disrupting the rest of the document', () => {
    const { root, parserWarnings } = parseXMLDocument('<root><a/></notopen><b/></root>');
    const rootEl = root.children[0];
    // </notopen> is ignored; <b/> still ends up as root's second child.
    assert.equal(rootEl.children.length, 2);
    assert.equal(rootEl.children[1].name, 'b');
    assert.ok(parserWarnings.some(w => /Unexpected closing tag <\/notopen>/.test(w)));
});

test('a closing tag that matches an ancestor (skipping an unclosed descendant) auto-repairs the nesting and reports it, without losing the descendant', () => {
    const { root, parserWarnings } = parseXMLDocument('<root><a><b></root>');
    const rootEl = root.children[0];
    const b = findFirst(rootEl, 'b');
    assert.ok(b, 'the unclosed <b> should still exist in the tree');
    assert.ok(parserWarnings.some(w => /<b> was not closed before <\/root> appeared/.test(w)));
});

test('tags still open at end-of-file are auto-closed and reported as a likely truncation', () => {
    const { root, parserWarnings } = parseXMLDocument('<root><a><b>');
    const rootEl = root.children[0];
    const b = findFirst(rootEl, 'b');
    assert.ok(b, 'the unclosed <b> should still exist in the tree');
    assert.ok(parserWarnings.some(w => /Reached end of file with 3 tag\(s\) still open \(innermost: <b>\)/.test(w)));
});

test('a well-formed document with proper closing tags produces zero parser warnings', () => {
    const { parserWarnings } = parseXMLDocument('<root><a><b/></a><c/></root>');
    assert.deepEqual(parserWarnings, []);
});
