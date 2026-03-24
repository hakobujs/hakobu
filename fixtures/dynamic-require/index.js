'use strict';
/**
 * Dynamic require fixture — directory-driven model loader pattern.
 *
 * This is the most common dynamic require pattern in real projects:
 * Sequelize model loaders, Express middleware loaders, plugin systems.
 *
 * The key: require(path.join(__dirname, 'models', filename))
 * where filename comes from fs.readdirSync().
 *
 * This ONLY works in packaged mode when the target files are declared
 * as assets in hakobu config: "assets": ["models/**\/*.js"]
 */

const fs = require('fs');
const path = require('path');

const checks = {};
checks.format = 'dynamic-require';

// Directory-driven loader (Sequelize pattern)
const modelsDir = path.join(__dirname, 'models');
const modelFiles = fs.readdirSync(modelsDir)
  .filter(f => f.endsWith('.js'))
  .sort();

checks.model_count = modelFiles.length;

const models = {};
for (const file of modelFiles) {
  const model = require(path.join(modelsDir, file));
  models[model.name] = model;
}

// Verify loaded models
checks.has_user = 'User' in models;
checks.has_post = 'Post' in models;
checks.user_fields = models.User ? models.User.fields.length : 0;
checks.post_fields = models.Post ? models.Post.fields.length : 0;

// Verify model data is correct
checks.user_name = models.User ? models.User.name : '';
checks.post_name = models.Post ? models.Post.name : '';

for (const [k, v] of Object.entries(checks)) {
  console.log(`${k}=${JSON.stringify(v)}`);
}
