const fs = require('fs').promises;
const path = require('path');
const { program } = require('commander');
const readline = require('readline');
const os = require('os');
const ProgressBar = require('progress');

const GR_HOST = "http://192.168.0.1/";
const PHOTO_LIST_URI = "v1/photos";
const GR_PROPS = "v1/props";
let STARTDIR = "";
let STARTFILE = "";

const DEVICE = "Ricoh GR IIIx";
const CONFIG_FILE = path.join(os.homedir(), '.grrc');

// Function to prompt user for input
function prompt(question) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            rl.close();
            resolve(answer);
        });
    });
}

// New function to poll for camera connection
async function pollForCameraConnection() {
    console.log("Please connect to your camera's WiFi network.");
    console.log("Press Ctrl+C to cancel at any time.");

    while (true) {
        try {
            const response = await fetch(GR_HOST + GR_PROPS);
            if (response.ok) {
                console.log("Successfully connected to the camera!");
                return;
            }
        } catch (error) {
            // Silently continue polling
        }
        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for 1 second before next poll
    }
}

// Function to read config file
async function readConfig() {
    try {
        const data = await fs.readFile(CONFIG_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        return {};
    }
}

// Function to write config file
async function writeConfig(config) {
    await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2));
}

async function getBatteryLevel() {
    try {
        const response = await fetch(GR_HOST + GR_PROPS);
        const props = await response.json();
        if (props.errCode !== 200) {
            console.error(`Error code: ${props.errCode}, Error message: ${props.errMsg}`);
            process.exit(1);
        } else {
            return props.battery;
        }
    } catch (error) {
        console.error(`Unable to fetch device props from ${DEVICE}`);
        process.exit(1);
    }
}

async function getPhotoList(photoDestDir) {
    try {
        const response = await fetch(GR_HOST + PHOTO_LIST_URI);
        const photoDict = await response.json();
        if (photoDict.errCode !== 200) {
            console.error(`Error code: ${photoDict.errCode}, Error message: ${photoDict.errMsg}`);
            process.exit(1);
        } else {
            const photoList = [];
            for (const dir of photoDict.dirs) {
                const dirPath = path.join(photoDestDir, dir.name);
                await fs.mkdir(dirPath, { recursive: true });
                
                for (const file of dir.files) {
                    photoList.push(`${dir.name}/${file}`);
                }
            }
            return photoList;
        }
    } catch (error) {
        console.error(`Unable to fetch photo list from ${DEVICE}`);
        process.exit(1);
    }
}

async function getLocalFiles(photoDestDir) {
    const fileList = [];
    const walk = async (dir) => {
        const files = await fs.readdir(dir);
        for (const file of files) {
            const filePath = path.join(dir, file);
            const stat = await fs.stat(filePath);
            if (stat.isDirectory()) {
                await walk(filePath);
            } else {
                fileList.push(path.relative(photoDestDir, filePath));
            }
        }
    };
    await walk(photoDestDir);
    return fileList;
}

async function fetchPhoto(photouri, photoDestDir) {
    try {
        const url = GR_HOST + PHOTO_LIST_URI + '/' + photouri;
        const response = await fetch(url);
        const buffer = await response.arrayBuffer();
        await fs.writeFile(path.join(photoDestDir, photouri), Buffer.from(buffer));
        return true;
    } catch (error) {
        return false;
    }
}

async function shutdownGR() {
    try {
        await fetch(`${GR_HOST}/v1/device/finish`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        });
    } catch (error) {
        console.error("Failed to shutdown GR");
    }
}

async function downloadPhotos(isAll, photoDestDir) {
    console.log(`Fetching photo list from ${DEVICE} ...`);
    const photoLists = await getPhotoList(photoDestDir);
    const localFiles = await getLocalFiles(photoDestDir);
    let startIndex = 0;

    const config = await readConfig();

    if (isAll) {
        // No change needed here
    } else if (config.lastImageCopied) {
        startIndex = photoLists.indexOf(config.lastImageCopied);
        if (startIndex === -1) {
            console.log(`Last copied image ${config.lastImageCopied} not found. Starting from the beginning.`);
            startIndex = 0;
        } else {
            startIndex += 1; // Start from the next image
        }
    } else {
        const starturi = `${STARTDIR}/${STARTFILE}`;
        startIndex = photoLists.indexOf(starturi);
        if (startIndex === -1) {
            console.error(`Unable to find ${starturi} on ${DEVICE}`);
            process.exit(1);
        }
    }

    photoLists.splice(0, startIndex);
    const totalPhoto = photoLists.length;

    console.log("Start to download photos ...");
    const bar = new ProgressBar('Downloading [:bar] :current/:total :percent :etas', {
        complete: '=',
        incomplete: ' ',
        width: 20,
        total: totalPhoto
    });

    for (const photouri of photoLists) {
        if (localFiles.includes(photouri)) {
            bar.tick();
        } else {
            if (await fetchPhoto(photouri, photoDestDir)) {
                config.lastImageCopied = photouri;
                await writeConfig(config);
                bar.tick();
            } else {
                console.log(`\nFailed to download ${photouri}`);
            }
        }
    }

    console.log("\nAll photos are downloaded.");
    await shutdownGR();
}

async function main() {
    program
        .description(`
grsync is a script allows you to sync photos from Ricoh GR IIIx via Wifi.

It automatically checks if photos already exists in your local drive. Duplicated
photos will be skipped and only sync needed photos for you.

Simple usage - Download ALL photos from Ricoh GR III:

    grsync -a

Advanced usage - Download photos after specific directory and file:

    grsync -d 100RICOH -f R0000005.JPG
    
    All photos after 100RICOH/R0000005.JPG will be downloaded, including all
    following directories (eg. 101RICOH, 102RICOH)
        `)
        .option('-a, --all', 'Download all photos')
        .option('-d, --dir <directory>', 'Assign directory (eg. -d 100RICOH). MUST use with -f')
        .option('-f, --file <filename>', 'Start to download photos from specific file (eg. -f R0000005.JPG). MUST use with -d')
        .parse(process.argv);

    const options = program.opts();

    console.log("Checking camera connection...");
    await pollForCameraConnection();

    let config = await readConfig();
    
    if (!config.photoDestDir) {
        config.photoDestDir = await prompt("Enter the destination directory for photos: ");
        await writeConfig(config);
    }

    console.log(`Photo destination directory: ${config.photoDestDir}`);

    if (await getBatteryLevel() < 15) {
        console.error("Your battery level is less than 15%, please charge it before sync operation!");
        process.exit(1);
    }

    if (options.all && !options.dir && !options.file) {
        await downloadPhotos(true, config.photoDestDir);
    } else if (options.dir && options.file && !options.all) {
        if (!/^[1-9]\d\dRICOH$/.test(options.dir)) {
            console.error("Incorrect directory name. It should be something like 100RICOH");
            process.exit(1);
        }
        if (!/^R0\d{6}\.JPG$/.test(options.file)) {
            console.error("Incorrect file name. It should be something like R0999999.JPG. (all in CAPITAL)");
            process.exit(1);
        }
        STARTDIR = options.dir;
        STARTFILE = options.file;
        await downloadPhotos(false, config.photoDestDir);
    } else {
        program.help();
    }
}

main().catch(error => {
    console.error("An error occurred:", error);
    process.exit(1);
});
