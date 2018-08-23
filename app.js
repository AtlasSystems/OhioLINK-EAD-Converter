#!/usr/bin/env node

'use strict';

const xpath = require('xpath');
const dom = require('xmldom').DOMParser;
const xmlSerializer = require('xmldom').XMLSerializer;
const path = require('path');
const fs = require('fs');
const program = require('commander');

var eadSourceDirectory, eadOutputDirectory, forceOverwriteOfOutput;

program
	.arguments('<source-directory> <output-directory>')
	.option("-f, --force_overwrite", "force overwrite of output directory")
	.action(function (source_directory, output_directory, options) {
		forceOverwriteOfOutput = options.force_overwrite || false;
		eadSourceDirectory = source_directory;
		eadOutputDirectory = output_directory;
		main();
	})

program.parse(process.argv);

function main() {

	console.log('Processing directory: %s', eadSourceDirectory)

	if (!fs.existsSync(eadSourceDirectory)) {
		console.log("no dir ", eadSourceDirectory);
		return;
	}

	if (!fs.existsSync(eadOutputDirectory)) {
		fs.mkdirSync(eadOutputDirectory);
	}
	else if (forceOverwriteOfOutput) {
		removeDirectory(eadOutputDirectory);
		fs.mkdirSync(eadOutputDirectory);
	}
	else {
		console.log("ERROR: Output directory already exists. Use -f option to force overwrite of the output directory.")
		return;
	}

	fs.readdirSync(eadSourceDirectory)
		.filter(file => file.match(/\.xml$/))
		.map(fileName => {
			let fullSourceFileName = path.join(eadSourceDirectory, fileName);
			let fullOutputFilename = path.join(eadOutputDirectory, fileName);

			console.log("Normalizing " + fullSourceFileName);

			fs.readFile(fullSourceFileName, 'utf-8', function (err, data) {
				if (err) {
					throw err;
				}

				let domParser = new dom();
				let doc = processEad(domParser.parseFromString(data, 'application/xml'));

				let domSerializer = new xmlSerializer();
				fs.writeFile(fullOutputFilename, domSerializer.serializeToString(doc), (err) => {
					if (err) throw err;

					console.log('The file ' + fullOutputFilename + ' has been saved!');
					return true;
				});

			});
		});
}

/**
 * Normalizes an EAD file and returns an in-memory representation.
 * 
 * @param {Document} doc XML Document object that represents the EAD.
 * @returns {Document} XML Document object with changes applied.
 */
function processEad(doc) {

	// Fix physdesc elements without inner extend elements
	// 	<physdesc label="Extent:" encodinganalog="300$a">.5 linear feet (1 box)</physdesc> 
	//	should be 
	//	<physdesc label="Extent:" encodinganalog="300$a"><extent>.5 linear feet (1 box)</extent></physdesc>
	xpath.select("//physdesc[not(extent)]", doc)
		.forEach(fixPhysDescNode);

	//
	// Remove all empty <p> tags.
	//
	xpath.select("//p[not(node())]", doc)
		.forEach(removeNode);

	//
	// Fix nodes without a body
	//
	let noteTypes = [
		"bioghist", "scopecontent", "arrangement",
		"accessrestrict", "userestrict", "prefercite",
		"acqinfo", "custodhist", "accruals"
	];

	for (var nodeName of noteTypes) {
		// Remove any truly blank notes
		xpath.select(`//${nodeName}[not(node())]`, doc)
			.forEach(removeNode);
		
		// Add a paragraph to notes that still exist but are missing a 
		// paragraph.
		xpath.select(`//${nodeName}[not(p)]`, doc)
			.forEach(node => addParagraph(node, "Not Specified"));
	}
	
	//
	// Remove unitdate elements with no expressions
	//
	xpath.select("//unitdate[not(node())]", doc)
		.forEach(removeNode);

	//
	// Fix containers without IDs
	//
	xpath.select("//container[not(node())]", doc)
		.forEach(fixContainersWithoutIds);

	//
	// Normalize subject terms
	//
	xpath.select("//subject", doc)
		.forEach(normalizeSubjectTerm);

	//
	// Normalize descrules
	//
	xpath.select("//descrules", doc)
		.forEach(normalizeDescRules);

	//
	// Normalize langusage
	//
	xpath.select("//langusage", doc)
		.forEach(normalizeLangUsage);

	//
	// Find any language nodes that don't have langcode attributes
	// Find acqinfo nodes without a body
	//
	xpath.select("//language[not(@langcode)]", doc)
		.forEach(addLangcodeAttributes);

	//
	// Remove "Finding aid for the" prefix from the titleproper
	//
	xpath.select("//titleproper", doc)
		.forEach(normalizeTitleProper);

	//
	// Remove "Finding aid prepared by" prefix from the author
	//
	xpath.select("//author", doc)
		.forEach(normalizeAuthor);

	//
	// Set the actual publication date.
	//
	xpath.select("//publicationstmt//date", doc)
		.forEach(badpubdate => {
			badpubdate.textContent = xpath.select("//profiledesc//creation//date", doc)[0].textContent;
		});

	return doc;
}

/**
 * Adds a langcode attribute to the specified language node.
 * 
 * @param {Node} node The node that needs to be fixed or 
 * cleaned up.
 */
function addLangcodeAttributes(node) {
	//PrintNode(node);
	var languageText = node.childNodes[0].nodeValue;

	var langcode = "";

	switch (languageText.toLowerCase()) {
		case "english":
			langcode = "eng";
			break;
		default:
			printNode(node);
			throw "Unrecognized language: " + languageText;
	}

	node.setAttribute("langcode", langcode);
}

/**
 * Appends a text node with the specified text to the specified node.
 * 
 * @param {Node} node The node that needs to be fixed or
 * @param {string} newId The text to add to the specified node
 * cleaned up.
 */
function fixContainersWithoutIds(node, newId = "?") {
	var textNode = node.ownerDocument.createTextNode(newId);
	node.appendChild(textNode);
}

/**
 * Fix physdesc elements without inner extend elements.
 * 
 * <physdesc label="Extent:" encodinganalog="300$a">.5 linear feet (1 box)</physdesc>
 * should be 
 * <physdesc label="Extent:" encodinganalog="300$a"><extent>.5 linear feet (1 box)</extent></physdesc>
 * 
 * @param {Node} node The node that needs to be fixed or cleaned up.
 */
function fixPhysDescNode(node) {
	var extentNode = node.ownerDocument.createElement("extent");

	while (node.hasChildNodes()) {
		var child = node.firstChild;
		node.removeChild(child);
		extentNode.appendChild(child);
	}

	node.appendChild(extentNode);
}

/**
 * Performs description rules cleanup operations on the specified node.
 * 
 * @param {Node} node The node that needs to be fixed or cleaned up.
 */
function normalizeDescRules(node) {
	if (node.childNodes.length == 0) {
		return;
	}

	var newText = "";

	// Check for a title element first
	var titleNodes = xpath.select("(.//title)", node);

	if (titleNodes[0] != null) {
		newText = titleNodes[0].childNodes[0].nodeValue;
	} else {
		// Just grab the text and try to clean it up.
		var existingText = node.childNodes[0].nodeValue;
		existingText = existingText.replace("Finding aid prepared using ", "");

		newText = existingText
	}

	// Remove all existing child nodes.
	while (node.hasChildNodes()) {
		node.removeChild(node.firstChild);
	}

	// Add back a plain text node with the desc rules
	var textNode = node.ownerDocument.createTextNode(newText);
	node.appendChild(textNode);
}

/**
 * Performs lang usage cleanup operations on the specified node.
 * 
 * @param {Node} node The node that needs to be fixed or cleaned up.
 */
function normalizeLangUsage(node) {
	if (node.childNodes.length == 0) {
		return;
	}
	// Check for a title element first

	var newText = xpath.select(".//language/text()", node)
		.join(" and ");

	// Remove all existing child nodes.
	while (node.hasChildNodes()) {
		node.removeChild(node.firstChild);
	}

	// Add back a plain text node with the new text
	var textNode = node.ownerDocument.createTextNode(newText);
	node.appendChild(textNode);
}

/**
 * Performs author cleanup operations on the specified node.
 * 
 * @param {Node} node The node that needs to be fixed or cleaned up.
 */
function normalizeAuthor(node) {
	if (node.childNodes.length == 0) {
		return;
	}

	var newText = node.textContent
		.replace(/^\s*Finding aid prepared by\s*/g, "");

	// Remove all existing child nodes.
	while (node.hasChildNodes()) {
		node.removeChild(node.firstChild);
	}

	// Add back a plain text node with the new text
	var textNode = node.ownerDocument.createTextNode(newText);
	node.appendChild(textNode);
}

/**
 * Performs titleproper cleanup operations on the specified node.
 * 
 * @param {Node} node The node that needs to be fixed or cleaned up.
 */
function normalizeTitleProper(node) {
	if (node.childNodes.length == 0) {
		return;
	}

	var newText = node.textContent
		.replace(/^\s*Finding aid for the\s*/g, "");

	// Remove all existing child nodes.
	while (node.hasChildNodes()) {
		node.removeChild(node.firstChild);
	}

	// Add back a plain text node with the new text
	var textNode = node.ownerDocument.createTextNode(newText);
	node.appendChild(textNode);
}

/**
 * Performs subject cleanup operations on the specified node.
 * 
 * @param {Node} node The node that needs to be fixed or cleaned up.
 */
function normalizeSubjectTerm(node) {
	//PrintNode(node);
	var term = node.childNodes[0].nodeValue;

	term = term.replace(/\s*--\s*/, "--");

	// We have to remove the existing text node to change it.	
	// Add back a plain text node with the new text	
	var textNode = node.ownerDocument.createTextNode(term);
	node.replaceChild(textNode, node.childNodes[0]);
}

/**
 * Adds a paragraph tag for the specified node, with the specified text.
 * 
 * @param {Node} node The node that needs a paragraph tag.
 */
function addParagraph(node, text = "Not specified") {
	var p = node.ownerDocument.createElement("p");
	p.appendChild(node.ownerDocument.createTextNode(text));
	node.appendChild(p);
}

/**
 * Removes the specified node from the XML document. 
 * 
 * @param {Node} node The node that needs to be removed.
 */
function removeNode(node) {
	// console.log("Remove node: " + node.toString());

	if (node.parentNode) {
		node.parentNode.removeChild(node);
	}
	else {
		console.log("WARNING: Cannot remove node that has no parent.");
	}
}

/**
 * Prints the specified array of XML Nodes to the console.
 * 
 * @param {Node[]} nodes 
 */
function printNodes(nodes) {
	(nodes || []).forEach(printNode);
}

/**
 * Prints the specified XML Node to the console.
 * 
 * @param {Node} node 
 */
function printNode(node) {
	if (!node) {
		console.log("Node is null and cannot be printed.");
	}

	console.log(node.toString());
}

/**
 * Removes a directory and all of its contents as long as the directory only 
 * contains files. 
 * 
 * @param {string} dir The directory that will be removed.
 */
function removeDirectory(dir) {
	if (!dir)
		throw "You must provide a directory";

	fs.readdirSync(dir).forEach(file => {
		console.log("Removing " + file);
		fs.unlinkSync(path.join(dir, file));
	});

	fs.rmdirSync(dir);
}

/**
 * Replaces all instances of the find text with the replace text.
 * 
 * @param {string} find The text that needs to be replaced.
 * @param {string} replace The text that will replace the found text.
 */
String.prototype.replaceAll = function (find, replace) {
	var str = this;
	return str.replace(new RegExp(find.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'), 'g'), replace);
};

