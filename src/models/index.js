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
  Object.assign(db, require("./liscence"));
} catch (err) {
  console.warn("[MODELS]: Failed to load liscence models.", err.message);
}



Object.keys(db).forEach((modelName) => {
  if (db[modelName].associate) {
    db[modelName].associate(db);
  }
});

if (db.User && db.Role && db.Permission) {
  db.Role.hasMany(db.User, { foreignKey: "role_id" });
  db.User.belongsTo(db.Role, { foreignKey: "role_id" });

  db.Role.belongsToMany(db.Permission, {
    through: "role_permissions",
    foreignKey: "role_id",
    otherKey: "permission_id",
  });
  db.Permission.belongsToMany(db.Role, {
    through: "role_permissions",
    foreignKey: "permission_id",
    otherKey: "role_id",
  });
}

db.sequelize = sequelize;

module.exports = db;
