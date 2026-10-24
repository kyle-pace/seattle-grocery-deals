// Free Apple "Personal Teams" can't sign apps with the Push Notifications capability.
// The app only uses local notifications for now, so drop the push entitlement that
// expo-notifications adds. Remove this plugin from app.json once there's a paid
// Apple Developer account and Firebase push is set up.
const { withEntitlementsPlist } = require("expo/config-plugins");

module.exports = function withoutPushEntitlement(config) {
  return withEntitlementsPlist(config, (c) => {
    delete c.modResults["aps-environment"];
    return c;
  });
};
