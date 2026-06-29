module.exports = (buildPath, templatePath, swDest) => ({
	globDirectory: buildPath,
	globPatterns: [
		'**/*.{json,png,jpg,css,html,svg,js}'
	],
	swDest: swDest,
	swSrc: templatePath,
}); 