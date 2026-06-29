// Generate config file by taking path to exp as input
// Concatenate internal service worker js with user provided js
const path = require("path");
const fs = require('fs');
const shell = require("shelljs");

function generateConfig(buildPath, swDest) {
    const configTemplate = require(path.resolve(__dirname, "./js/configTemplate.js"));
    const finalServiceWorkerPath = path.resolve(__dirname, "./js/finalSW.js");
    const pathToServiceWorkerConfig = path.resolve(__dirname, "./js/config.js");
    const config = configTemplate(buildPath, finalServiceWorkerPath, swDest);

    const outputConfig = `module.exports = ${JSON.stringify(config, null, 2)};\n`;
    fs.writeFileSync(pathToServiceWorkerConfig, outputConfig);
}

function deleteConfig() {
    const pathToServiceWorkerConfig = path.resolve(__dirname, "./js/config.js");
    fs.unlinkSync(pathToServiceWorkerConfig);
}

function deleteFinalServiceWorker() {
    const finalServiceWorkerPath = path.resolve(__dirname, "./js/finalSW.js");
    fs.unlinkSync(finalServiceWorkerPath);
}

function concatenate(inputFilePath) {
    const templatePath = path.resolve(__dirname, "./js/template.js");
    const finalServiceWorkerPath = path.resolve(__dirname, "./js/finalSW.js");
    const templateContent = fs.readFileSync(templatePath, 'utf8');
    let concatenatedContent;
    if (inputFilePath !== "") {
        const inputContent = fs.readFileSync(inputFilePath, 'utf8');
        concatenatedContent = templateContent + '\n' +inputContent;
    } else {
        concatenatedContent = templateContent;
    }
    fs.writeFileSync(finalServiceWorkerPath, concatenatedContent);
}

function injectManifest() {
    const pathToServiceWorkerConfig = path.resolve(__dirname, "./js/config.js");
    shell.exec(`npx workbox injectManifest ${pathToServiceWorkerConfig}`);
}

function run(inputFilePath, buildPath, swDest) {
    generateConfig(buildPath, swDest);
    concatenate(inputFilePath);
    injectManifest();
    deleteConfig();
    deleteFinalServiceWorker();
}

exports.generateSW = run;