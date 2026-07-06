const License = require("./license.model");
const LicenseSoftware = require("./license_software.model");
const LicenseTicket = require("./license_ticket.model");

License.hasMany(LicenseSoftware, {
  foreignKey: "licenseId",
  sourceKey: "licenseId",
  as: "software",
  onDelete: "CASCADE",
  onUpdate: "CASCADE",
});
LicenseSoftware.belongsTo(License, {
  foreignKey: "licenseId",
  targetKey: "licenseId",
  as: "license",
});

License.hasMany(LicenseTicket, {
  foreignKey: "licenseId",
  sourceKey: "licenseId",
  as: "tickets",
  onDelete: "CASCADE",
  onUpdate: "CASCADE",
});
LicenseTicket.belongsTo(License, {
  foreignKey: "licenseId",
  targetKey: "licenseId",
  as: "license",
});

module.exports = {
  License,
  LicenseSoftware,
  LicenseTicket,
};
