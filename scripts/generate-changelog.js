#!/usr/bin/env node
/**
 * Generate changelog from conventional commits between two git refs.
 *
 * Usage:
 *   node scripts/generate-changelog.js                   # since last tag
 *   node scripts/generate-changelog.js v0.1.0..HEAD      # explicit range
 *   node scripts/generate-changelog.js v0.1.0..v0.2.0    # between tags
 *
 * Output: Markdown changelog to stdout.
 *
 * Commit format expected: type(scope): message
 *   feat(packager): add multi-target packaging
 *   fix(bundler): use file:// URL for Rolldown
 *   docs: update runtime support
 *   ci: add RC gate
 */

'use strict';

const { execFileSync } = require('child_process');

const CATEGORIES = {
  feat: { title: 'Features', emoji: '' },
  fix: { title: 'Bug Fixes', emoji: '' },
  perf: { title: 'Performance', emoji: '' },
  refactor: { title: 'Refactoring', emoji: '' },
  docs: { title: 'Documentation', emoji: '' },
  test: { title: 'Tests', emoji: '' },
  ci: { title: 'CI/CD', emoji: '' },
  chore: { title: 'Chores', emoji: '' },
  plan: { title: 'Planning', emoji: '' },
};

function getRange() {
  const arg = process.argv[2];
  if (arg && arg.includes('..')) return arg;

  // Find the most recent tag
  try {
    const tag = execFileSync('git', ['describe', '--tags', '--abbrev=0'], {
      encoding: 'utf8',
    }).trim();
    return `${tag}..HEAD`;
  } catch {
    // No tags — use all history
    return 'HEAD';
  }
}

function getCommits(range) {
  const args = ['log', '--format=%H %s', '--no-merges'];
  if (range === 'HEAD') {
    args.push('HEAD');
  } else {
    args.push(range);
  }

  const output = execFileSync('git', args, { encoding: 'utf8' }).trim();
  if (!output) return [];

  return output.split('\n').map(line => {
    const hash = line.slice(0, 40);
    const subject = line.slice(41);
    return { hash: hash.slice(0, 7), subject };
  });
}

function parseCommit(subject) {
  // Match: type(scope): message  or  type: message
  const match = subject.match(/^(\w+)(?:\(([^)]*)\))?:\s*(.+)/);
  if (!match) return { type: 'other', scope: null, message: subject };
  return { type: match[1], scope: match[2] || null, message: match[3] };
}

function generateChangelog(range) {
  const commits = getCommits(range);
  if (commits.length === 0) {
    return 'No changes.\n';
  }

  // Group by category
  const groups = {};
  const uncategorized = [];

  for (const commit of commits) {
    const parsed = parseCommit(commit.subject);
    const cat = CATEGORIES[parsed.type];
    if (cat) {
      if (!groups[parsed.type]) groups[parsed.type] = [];
      groups[parsed.type].push({ ...commit, ...parsed });
    } else {
      uncategorized.push({ ...commit, ...parsed });
    }
  }

  // Build markdown
  const lines = [];

  // Ordered output by category priority
  const order = ['feat', 'fix', 'perf', 'refactor', 'docs', 'test', 'ci', 'chore', 'plan'];
  for (const type of order) {
    const items = groups[type];
    if (!items || items.length === 0) continue;
    const cat = CATEGORIES[type];
    lines.push(`### ${cat.title}`);
    lines.push('');
    for (const item of items) {
      const scope = item.scope ? `**${item.scope}:** ` : '';
      lines.push(`- ${scope}${item.message} (${item.hash})`);
    }
    lines.push('');
  }

  if (uncategorized.length > 0) {
    lines.push('### Other');
    lines.push('');
    for (const item of uncategorized) {
      lines.push(`- ${item.subject} (${item.hash})`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

const range = getRange();
const changelog = generateChangelog(range);
process.stdout.write(changelog);
