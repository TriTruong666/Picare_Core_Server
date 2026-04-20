"use strict";

const fs = require("fs");
const path = require("path");
const sequelize = require("../config/postgres.config");

const db = {};

// 1. Quét các model ở thư mục gốc (.model.js)
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

// 2. Import các model từ thư mục chat (nếu có)
try {
  const chatModels = require("./chat");
  Object.assign(db, chatModels);
} catch (err) {
  console.warn("[MODELS]: Không tìm thấy hoặc lỗi khi load thư mục chat.");
}

// 3. Thiết lập quan hệ (nếu model có hàm associate)
Object.keys(db).forEach((modelName) => {
  if (db[modelName].associate) {
    db[modelName].associate(db);
  }
});

// 4. Thiết lập quan hệ RBAC thủ công
if (db.User && db.Role && db.Permission) {
  // User belongs to one Role
  db.Role.hasMany(db.User, { foreignKey: "role_id" });
  db.User.belongsTo(db.Role, { foreignKey: "role_id" });

  // Role can have many Permissions (n-n)
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
