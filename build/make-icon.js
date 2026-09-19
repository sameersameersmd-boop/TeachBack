const fs = require('fs');

const pngToIcoModule = require('png-to-ico');
const pngToIco = pngToIcoModule.default || pngToIcoModule;

const input = 'frontend/public/teachback-logo.png';
const output = 'build/icon.ico';

async function createIcon() {
    if (!fs.existsSync(input)) {
        throw new Error(`Logo not found: ${input}`);
    }

    if (typeof pngToIco !== 'function') {
        throw new Error(
            'png-to-ico did not expose a callable conversion function.'
        );
    }

    const ico = await pngToIco(input);

    fs.writeFileSync(output, ico);

    console.log('');
    console.log('============================================');
    console.log('TeachBack Windows icon created successfully!');
    console.log('============================================');
    console.log(`Input : ${input}`);
    console.log(`Output: ${output}`);
    console.log('');
}

createIcon().catch((error) => {
    console.error('');
    console.error('Failed to create icon:');
    console.error(error);
    process.exit(1);
});