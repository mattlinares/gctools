import Promise from 'bluebird';
import GhostAdminAPI from '@tryghost/admin-api';
import {makeTaskRunner} from '@tryghost/listr-smart-renderer';
import _ from 'lodash';
import {discover} from '../lib/batch-ghost-discover.js';

const initialise = (options) => {
    return {
        title: 'Initialising API connection',
        task: (ctx, task) => {
            try {
                let defaults = {
                    verbose: false,
                    delayBetweenCalls: 50,
                    content: 'Test endnote content'
                };

                if (!options.apiURL) {
                    throw new Error('API URL is required');
                }

                if (!options.adminAPIKey) {
                    throw new Error('Admin API key is required');
                }

                const url = options.apiURL.replace(/\/$/, '');
                const key = options.adminAPIKey;
                const api = new GhostAdminAPI({
                    url: url.replace('localhost', '127.0.0.1'),
                    key,
                    version: 'v5.0'
                });

                ctx.args = _.mergeWith(defaults, options);
                ctx.api = api;
                ctx.posts = [];
                ctx.updated = [];
                ctx.errors = [];

                // Create the endnote HTML block
                ctx.endnoteBlock = `<div class="gh-content-endnote" data-type="4">${ctx.args.content}</div>`;

                task.output = `Initialised API connection for ${options.apiURL}`;
            } catch (error) {
                ctx.errors = ctx.errors || [];
                ctx.errors.push(error);
                task.output = `Error initialising API connection: ${error.message}`;
                throw error;
            }
        }
    };
};

const getFullTaskList = (options) => {
    return [
        initialise(options),
        {
            title: 'Fetch Posts from Ghost API by ID',
            task: async (ctx, task) => {
                if (!ctx.args.postIds || ctx.args.postIds.length === 0) {
                    task.output = 'No post IDs provided';
                    return;
                }

                // Create filter for posts by ID
                const idFilter = `id:[${ctx.args.postIds.join(',')}]`;

                let postDiscoveryOptions = {
                    api: ctx.api,
                    type: 'posts',
                    limit: 100,
                    fields: 'id,title,slug,html,updated_at',
                    filter: idFilter,
                    formats: 'html,lexical,mobiledoc' // Request all formats to work with the appropriate one
                };

                try {
                    ctx.posts = await discover(postDiscoveryOptions);
                    task.output = `Found ${ctx.posts.length} posts`;
                } catch (error) {
                    ctx.errors.push(error);
                    throw error;
                }
            }
        },
        {
            title: 'Adding endnote block to posts',
            task: async (ctx) => {
                let tasks = [];

                await Promise.mapSeries(ctx.posts, async (post) => {
                    tasks.push({
                        title: `${post.title}`,
                        task: async () => {
                            try {
                                let result;

                                // Work with Lexical format if available (preferred)
                                if (post.lexical) {
                                    let updatedLexical = JSON.parse(post.lexical);
                                    
                                    // Create an HTML card for the endnote block
                                    const htmlCard = {
                                        type: 'html',
                                        version: 1,
                                        html: ctx.endnoteBlock
                                    };

                                    // Check if an endnote block already exists in Lexical
                                    // Look for HTML cards that contain the endnote class
                                    const endnoteCardIndex = updatedLexical.root.children.findIndex((child) => {
                                        return child.type === 'html' && 
                                               child.html && 
                                               child.html.includes('class="gh-content-endnote"');
                                    });

                                    if (endnoteCardIndex !== -1) {
                                        // Replace existing endnote card
                                        updatedLexical.root.children[endnoteCardIndex] = htmlCard;
                                    } else {
                                        // Append the HTML card to the end of the Lexical document
                                        updatedLexical.root.children.push(htmlCard);
                                    }

                                    updatedLexical = JSON.stringify(updatedLexical, null, 2);

                                    result = await ctx.api.posts.edit({
                                        id: post.id,
                                        updated_at: post.updated_at,
                                        lexical: updatedLexical
                                    });
                                } else if (post.mobiledoc || post.html) {
                                    // For Mobiledoc or HTML-only posts, work with HTML
                                    let updatedHtml = post.html || '';

                                    // Check if endnote block already exists in HTML
                                    // Use regex to find and replace existing endnote divs
                                    const endnoteRegex = /<div\s+class="gh-content-endnote"[^>]*>.*?<\/div>/gis;
                                    
                                    if (endnoteRegex.test(updatedHtml)) {
                                        // Replace existing endnote block
                                        updatedHtml = updatedHtml.replace(endnoteRegex, ctx.endnoteBlock);
                                    } else {
                                        // Append the endnote block if it doesn't exist
                                        updatedHtml = updatedHtml 
                                            ? `${updatedHtml}\n\n${ctx.endnoteBlock}`
                                            : ctx.endnoteBlock;
                                    }

                                    result = await ctx.api.posts.edit({
                                        id: post.id,
                                        updated_at: post.updated_at,
                                        html: updatedHtml
                                    });
                                } else {
                                    // Fallback: just add the endnote block
                                    const updatedHtml = ctx.endnoteBlock;

                                    result = await ctx.api.posts.edit({
                                        id: post.id,
                                        updated_at: post.updated_at,
                                        html: updatedHtml
                                    });
                                }

                                ctx.updated.push(result.url);
                                return Promise.delay(ctx.args.delayBetweenCalls).return(result);
                            } catch (error) {
                                error.resource = {
                                    title: post.title
                                };
                                ctx.errors.push(error);
                                throw error;
                            }
                        }
                    });
                });

                let postTaskOptions = options;
                postTaskOptions.concurrent = 1;
                return makeTaskRunner(tasks, postTaskOptions);
            }
        }
    ];
};

const getTaskRunner = (options) => {
    let tasks = [];

    tasks = getFullTaskList(options);

    return makeTaskRunner(tasks, Object.assign({topLevel: true}, options));
};

export default {
    initialise,
    getFullTaskList,
    getTaskRunner
};

