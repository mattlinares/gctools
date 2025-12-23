import {ui} from '@tryghost/pretty-cli';
import addEndnote from '../tasks/add-endnote.js';

// Internal ID in case we need one.
const id = 'add-endnote';

const group = 'Content:';

// The command to run and any params
const flags = 'add-endnote <apiURL> <adminAPIKey>';

// Description for the top level command
const desc = 'Add endnote HTML block to posts in Ghost';

// Descriptions for the individual params
const paramsDesc = [
    'URL to your Ghost API',
    'Admin API key'
];

// Configure all the options
const setup = (sywac) => {
    sywac.boolean('-V --verbose', {
        defaultValue: false,
        desc: 'Show verbose output'
    });
    sywac.string('--postIds', {
        desc: 'Comma separated list of post IDs, inside single quotes. i.e. \'id1,id2,id3\''
    });
    sywac.string('--content', {
        defaultValue: 'Test endnote content',
        desc: 'Content for the endnote block (defaults to "Test endnote content")'
    });
    sywac.number('--delayBetweenCalls', {
        defaultValue: 50,
        desc: 'The delay between API calls, in ms'
    });
};

// What to do when this command is executed
const run = async (argv) => {
    let timer = Date.now();
    let context = {errors: []};

    // Validate required parameters
    if (!argv.apiURL) {
        ui.log.error('Error: apiURL is required');
        return;
    }

    if (!argv.adminAPIKey) {
        ui.log.error('Error: adminAPIKey is required');
        return;
    }

    if (!argv.postIds || !argv.postIds.trim()) {
        ui.log.error('Error: --postIds is required');
        return;
    }

    argv.postIds = argv.postIds.split(',').map((item) => {
        return item.trim();
    }).filter((item) => item.length > 0);

    try {
        // Fetch the tasks, configured correctly according to the options passed in
        let runner = addEndnote.getTaskRunner(argv);

        // Run the migration
        await runner.run(context);
    } catch (error) {
        if (context.errors && context.errors.length > 0) {
            ui.log.error('Done with errors');
            context.errors.forEach((err) => {
                ui.log.error(`  - ${err.message || err.toString()}`);
                if (err.stack && argv.verbose) {
                    ui.log.error(err.stack);
                }
            });
        } else {
            ui.log.error('Error:', error.message || error.toString());
            if (error.stack && argv.verbose) {
                ui.log.error(error.stack);
            }
        }
    }

    // Report success
    if (context.updated && context.updated.length > 0) {
        ui.log.ok(`Successfully updated ${context.updated.length} posts in ${Date.now() - timer}ms.`);
    }
};

export default {
    id,
    group,
    flags,
    desc,
    paramsDesc,
    setup,
    run
};

