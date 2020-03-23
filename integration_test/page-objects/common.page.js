module.exports = {
  // generics
  objWithClassAndText: (obj, classname, text) =>
    `//${obj}[contains(string(), "${text}")][contains(@class, "${classname}")]`,

  divRoleButtonWithText: text =>
    `//div[contains(string(), "${text}")][contains(@role, "button")]`,
  divRoleButtonDangerWithText: text =>
    `${module.exports.divRoleButtonWithText(text)}`,
  inputWithPlaceholder: placeholder =>
    `//input[contains(@placeholder, "${placeholder}")]`,
  textAreaWithPlaceholder: placeholder =>
    `//textarea[contains(@placeholder, "${placeholder}")]`,
  divWithClass: classname => `//div[contains(@class, "${classname}")]`,
  divWithClassAndText: (classname, text) =>
    module.exports.objWithClassAndText('div', classname, text),
  spanWithClassAndText: (classname, text) =>
    module.exports.objWithClassAndText('span', classname, text),
  toastWithText: text =>
    module.exports.divWithClassAndText('session-toast-wrapper', text),
};
