"use strict";

const fs = require("fs");
const path = require("path");
const sequelize = require("../config/postgres.config");

const db = {};

fs.readdirSync(__dirname)
  .filter((file) => {
    return (
      file.indexOf(".") !== 0 &&
      file !== "index.js" &&
      file.slice(-9) === ".model.js"
    );
  })
  .forEach((file) => {
    const model = require(path.join(__dirname, file));
    db[model.name] = model;
  });

try {
  Object.assign(db, require("./chat"));
} catch (err) {
  console.warn("[MODELS]: Failed to load chat models.", err.message);
}

try {
  Object.assign(db, require("./contract"));
} catch (err) {
  console.warn("[MODELS]: Failed to load contract models.", err.message);
}

try {
  Object.assign(db, require("./product_qr"));
} catch (err) {
  console.warn("[MODELS]: Failed to load product_qr models.", err.message);
}

try {
  Object.assign(db, require("./licence"));
} catch (err) {
  console.warn("[MODELS]: Failed to load license models.", err.message);
}

try {
  Object.assign(db, require("./catalogue"));
} catch (err) {
  console.warn("[MODELS]: Failed to load catalogue models.", err.message);
}

// Execute all associations
Object.keys(db).forEach((modelName) => {
  if (db[modelName] && typeof db[modelName].associate === "function") {
    db[modelName].associate(db);
  }
});

db.sequelize = sequelize;

module.exports = db;

