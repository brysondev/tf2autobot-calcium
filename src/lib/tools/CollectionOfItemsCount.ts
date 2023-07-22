/**
 * This module adds some functionality to get stats of a certain weapon
 * when your bot is being used as a gimmick one trick pony.
 *
 * Most of this code was just ripped from pre-existing stuff already in
 * the repo, but adjusted to fit. But imma take full credit anyways.
 *
 * brysondev wuz here
 *
 * special thanks to skel for this idea
 *
 */

import * as files from '../../lib/files';
import { loadOptions } from '../../classes/Options';
import path from 'path';
import axios from 'axios';
import cheerio from 'cheerio';
import { XMLParser } from 'fast-xml-parser';
import Bot from '../../classes/Bot';
import log from '../../lib/logger';
import SKU from '@tf2autobot/tf2-sku';
import dayjs from 'dayjs';
import { statsOfWeapon } from '../../classes/MyHandler/interfaces';
import Inventory from '../../classes/Inventory';
import SteamID from 'steamid';

export default class CollectionOfItemsCount {
    constructor(private readonly bot: Bot) {
        this.bot = bot;
    }

    private retryFetchInventoryTimeout: NodeJS.Timeout;

    private indexRetry: number;

    private retryLoop = false;

    async send(): Promise<string> {
        // brysondev wuz here.
        log.debug('showItemCount === true');
        // Call module and put string as active game.
        const statsMsg = await this.SendStatsOfWeaponCollection();
        let formatStringFromStats = '';
        log.warn(JSON.stringify(statsMsg));
        if (statsMsg !== null) {
            log.debug('statsMsg !== null');
            log.debug(`Values: ${statsMsg.numberInExistence}, ${statsMsg.timestamp}, ${statsMsg.numberOwned}`);
            formatStringFromStats = `💀#: ${statsMsg.numberOwned} | ${
                (statsMsg.numberOwned / statsMsg.numberInExistence) * 100
            } of all BOH's`;
        }
        return formatStringFromStats;
    }

    private options = loadOptions();

    private fileForCounts = path.join(__dirname, `../../files/${this.options.steamAccountName}/oneTrickStats.json`);

    SendStatsOfWeaponCollection(): Promise<statsOfWeapon> {
        const outputString = this.GetCachedStatsOfWeapon();
        return outputString;
    }

    private GetCachedStatsOfWeapon(): Promise<statsOfWeapon> {
        files
            .readFile(this.fileForCounts, true)
            .then(async (statsOfWeapon: statsOfWeapon | null) => {
                if (statsOfWeapon === null) {
                    log.warn(`File oneTrickStats.json does not exist! Creating...`);
                    return await this.GetUpdatedStatsOfWeapon();
                }
                const now = dayjs().unix();
                const expiredDate = statsOfWeapon.timestamp * 3600 > now;
                if (expiredDate) return statsOfWeapon;
            })
            .catch(err => {
                // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
                log.error(`GetCachedStatsOfWeapon(): ${err}`);
            });
        return null;
    }

    private async GetUpdatedStatsOfWeapon(): Promise<void> {
        await this.GetGroupMembersAsArray()
            .then(async members => {
                await this.getNumberOfItemsFromMembersInventories(members)
                    .then(async number => {
                        if (number === -1) return Promise.reject('Failed to get items list... Aborting.');
                        const numberOfExisting = await this.GetAllExistingItems();
                        log.debug(`${numberOfExisting} || ${number}`);
                        if (parseInt(numberOfExisting) && number > 0) {
                            const statsOfWeapon = {
                                numberOwned: number,
                                numberInExistance: numberOfExisting,
                                timestamp: dayjs().unix()
                            };
                            void files.writeFile(
                                path.join(__dirname, `../../files/${this.options.steamAccountName}/oneTrickStats.json`),
                                statsOfWeapon,
                                true
                            );
                        }
                    })
                    .catch();
            })
            .catch();
    }

    private async getNumberOfItemsFromMembersInventories(members: string[]): Promise<number> {
        let estimateNumberOwned = 0;
        for (let index = 0; index < members.length; index++) {
            if (this.retryLoop) {
                this.retryLoop = false;
                index = this.indexRetry;
            }
            try {
                // Grab entire tf2 inventory
                const memberSteamID = new SteamID(members[index]);
                const theirInventory = new Inventory(memberSteamID, this.bot, 'their', this.bot.boundInventoryGetter);
                clearTimeout(this.retryFetchInventoryTimeout);
                this.retryFetchInventoryTimeout = setTimeout(() => {
                    try {
                        void theirInventory.fetch();
                    } catch (err) {
                        this.retryLoop = true;
                        this.indexRetry = index;
                        log.error(`Failed to load inventories (${members[index]}): `, err);
                        log.debug('Retrying to fetch inventory in 30 seconds...');
                    }
                }, 30 * 1000);
                // Add their items
                const theirAssetids = theirInventory.findBySKU(this.options.collectionOfItemsCount.itemSKU, true);
                const theirAssetidsCount = theirAssetids.length;
                estimateNumberOwned += theirAssetidsCount;
            } catch (err) {
                log.error(`Failed to load inventories (${members[index]}): `, err);
                return Promise.reject(-1);
            }
        }
        return Promise.resolve(estimateNumberOwned);
    }

    private async GetGroupMembersAsArray(): Promise<string[]> {
        const groups = await this.GetGroups();
        return Promise.resolve(groups);
    }

    private async GetGroups(): Promise<string[]> {
        const groupIds: string[] = [];
        for (let index = 0; index < this.options.collectionOfItemsCount.steamGroupId.length; index++) {
            void (await axios({
                url: `https://steamcommunity.com/gid/${this.options.collectionOfItemsCount.steamGroupId[index]}/memberslistxml/?xml=1`,
                method: 'GET'
            })
                .then(response => {
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
                    const result = response.data;
                    const parser = new XMLParser({
                        numberParseOptions: { leadingZeros: true, hex: true, skipLike: /\+[0-9]{10}/ }
                    });
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment
                    const rawData = parser.parse(result);
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-member-access
                    for (let index = 0; index < rawData.memberList.members.steamID64.length; index++) {
                        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument
                        groupIds.push(rawData.memberList.members.steamID64[index]);
                    }
                })
                .catch(err => {
                    if (err) {
                        // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
                        log.error(`GetGroups(): ${err}`);
                    }
                }));
        }
        return Promise.resolve(groupIds);
    }

    /**
     * HELLO READ MEE!!!!!!!!!
     * THIS IS SCRAPING AND ITS SO SCUFFED. PLEASE USE A ROTATING PROXY SERVICE IF YOU PLAN TO USE THIS MORE!!!!!!!!
     */
    private async GetAllExistingItems(): Promise<string> {
        const skuToActualName = this.bot.schema
            .getName(SKU.fromString(this.options.collectionOfItemsCount.itemSKU), false)
            .replace(' ', '%20');
        const totalInExistence = new Promise<string>(resolve => {
            void axios({
                url: `https://backpack.tf/stats/Unique/${skuToActualName}/Tradable/Craftable`,
                method: 'GET',
                headers: {
                    'User-Agent': 'TF2Autobot@' + process.env.BOT_VERSION,
                    Cookie: 'user-id=' + this.bot.userID
                },
                params: {
                    key: process.env.BPTF_API_KEY
                }
            })
                .then(({ data }) => {
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
                    const $ = cheerio.load(data);
                    const daTotal = $('.well')
                        .map((_, value) => {
                            const $value = $(value);
                            return $value.text();
                        })
                        .toArray()
                        .join();
                    const extractValue = daTotal.split('are')[1].trim().split(' ')[0].replace(',', '');
                    return resolve(extractValue);
                })
                .catch(err => {
                    if (err) {
                        // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
                        log.error(`GetAllExistingItems(): ${err}`);
                    }
                });
        });
        return totalInExistence;
    }
}
