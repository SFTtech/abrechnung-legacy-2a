const group = require("../eval/group.js");
const fs = require("fs");

const group_object = JSON.parse(fs.readFileSync("../group_example.json"));

result = group.evaluate(group_object, ["mic_e", "jj"]);

console.log(result);
