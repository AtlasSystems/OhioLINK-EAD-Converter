# OhioLINK EAD Cleanup Script

This repository contains a NodeJS script that cleans up EAD XMLs from OhioLINK,
so they can be imported into ArchivesSpace.

## Usage

You will need to have NodeJS and NPM installed. After cloning this repository,
download the required dependencies by running npm install.

```bash
git clone https://github.com/AtlasSystems/OhioLINK-EAD-Converter.git
cd OhioLINK-EAD-Converter/
npm install
```

Download all of the EAD XMLs that you would like to import into ArchivesSpace
and place them into the same folder. The script runs as a command line utility,
which accepts the input and output directories as inputs.

The script will create the output directory. The script will exit if the output
directory already exists, unless the -f option exists.

```bash
# Running the script for the first time
node app.js /path/to/ohiolink-eads /path/to/corrected-ohiolink-eads

# Running the script a second time, with the "force" flag
node app.js /path/to/ohiolink-eads /path/to/corrected-ohiolink-eads -f
```
