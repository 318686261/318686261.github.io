/**
 * 群岛掠夺
 */
const logger = require('pomelo-logger').getLogger('apphttp-log', __filename);
const redisClient = require('../../../dao/redis/redisClient').getClient();
const islandsPlunder = require('../../../../config/islandsPlunder.json');
const goodsDao = require('../../../dao/goodsDao');
const matchService = require('./matchService');
const utils = require('../../../util/utils');

//#region ==============================================说明=======================================================
/**
 *个人岛屿信息 redis key
 *islandPlunder:userID = {
 *    updateTime: 1,//刷新时间，第几天刷新的
 *    dayResidueTimes: 5,//今天剩余次数，每日刷新
 *    dayAddTimes: 1,//今日增加次数，每日刷新
 *    payOccupyTimes: 1,//购买的最大占领数量，永久保留
 *    //收益，下次进群岛清空
 *    income: [
 *        {
 *            islandID: 1,//岛屿id
 *            occupyTime: 1,//占领了多久，分钟
 *            userID: 1,//-1自动到期，0被抢
 *            date: Date.now(),//时间
 *            candidate: 1,//1候补，2伪候补
 *            loss: 1,//损失
 *        }
 *    ],
 *    //战绩，最多10条战绩，下次进群岛清空
 *    record: [
 *        {
 *            islandID: 1,//岛屿id
 *            userID: 1,//攻打者
 *            result: 1,//结果，1攻打成功，2攻打失败    
 *            date: Date.now(),//时间
 *            candidate: 1,//1候补，2伪候补
 *        }
 *    ],
 *    occupyed: [],//占领的岛屿
 *    isVIP: 1,//vip
 *    week: 1,//排行榜上报分数用的周，时间戳
 *    score: 1,//排行榜分数
 *    
 *    candidate: [],//候补的岛屿
 *}
 *
 *
 *岛屿信息 redis key
 *island:岛屿id = {
 *    id: 1,//岛屿id
 *
 *    plunderUserID: -1,//掠夺者userID,-1无掠夺者
 *    battleFormation: {},//守护者的阵型
 *    plunderTime: 0,//什么时候掠夺的
 *
 *    occupyingUserID: -1,//占领中，-1没人
 *    occupyStartTime: 0,//什么时候开始占领的
 *}
 * 
 * 候补 redis key
 * islandCandidate:岛屿id
 * [
 *   {
 *       "userID": "335",//候补者userID
 *       "result": 1,//挑战岛主结果，1胜利，2失败
 *       "round": 8,//打了多少回合
 *       "hpPercent": 3270,//胜利时自己掉血，失败时打了岛主多少血
 *       "combat": 195345,//战力
 *       "date": 1696902860392,//候补时间
 *       "nickName": "昵称",
 *       "head": "14",//头像
 *       "headRing": "7",//头环
 *       "battleFormation": [],//战斗阵容
 *   },
 *   {
 *      ...
 *   }
 * ]
 *
 *json配置文件
 *{
 *    occupyOnceMax: 1,//最多同时占领
 *    VIPIncrease: 1,//VIP数量增加
 *    increasePay: 500,//增加数量花费钻石
 *    diamondsIncreaseLimit: 1,//增加数量上限
 *    occupyLimit: 3,//占领上限
 *
 *    dayResidueTimes: 5,//每天占领次数
 *    monthCardIncrease: 1,//月卡额外次数
 *    timesPay: [100, 200, 350],//增加次数消耗钻石
 *
 *    maxFightTime: 360,//最长攻打时间，秒
 *
 *    channelCount": 2,//开启频道数量
 *
 *    candidateMaxCount: 30,//最多候补人数
 *    candidateNeedRound: 20,//进入候补回合数
 * 
 *    //所有的岛屿
 *    Islands: [
 *        {
 *            id: 1,//岛屿id
 *            guardTime: 60,//这座岛受保护的时间有多久，分钟
 *            maxPlunderTime: 180,//最长掠夺时间，分钟
 *            score: 3,//掠夺完成时获得排行榜分数
 *        }, {
 *            id: 2,
 *            guardTime: 60,
 *            maxPlunderTime: 180,
 *        }, {
 *            id: 3,
 *            guardTime: 60,
 *            maxPlunderTime: 180,
 *        }
 *    ],
 *}
 *
 * 修改结算时间：
 * islandsPlunderService.getNowTimeStampWeeks()
 * match.json
 * 
 */
//#endregion

let exp = module.exports;
let MAIL_EXPIRE_TIME = 30 * 24 * 3600;//过期时间30天

/**
 * 获取全局信息
 * @param {*} userID 
 * @param {*} flag 用于区分有没有分频道的版本
 * @param {*} channelID 
 * @param {*} changeChannel 
 * @returns 
 */
exp.getAllInfo = async function (userID, flag, channelID, changeChannel) {
    let result = { code: 10000 }
    let date = Date.now();

    // 维护
    // result.code = 100000;
    // return result;

    let openChannel = [];
    for (let index = 0; index < islandsPlunder.channelCount; index++) {
        openChannel.push(index);
    }

    if (channelID != null) {
        channelID = parseInt(channelID);
    }

    if (flag == null) {
        //分频道之前的版本只能进0频道
        channelID = 0;
    } else if (channelID == null || channelID < 0 || openChannel.indexOf(channelID) == -1) {
        //随机频道
        channelID = openChannel[utils.randomRangeInt(0, openChannel.length)];
    }

    let userDBkey = 'userIslandInfo:' + userID;

    let userIslandInfo = await getUserIslandInfo(userID);

    let userInfo = await (new Promise(function (resolve, reject) {
        redisClient.hgetall('userinfo:' + userID, function (err, obj) {
            if (err != null) {
                logger.error(err);
                reject(false);
            } else {
                if (obj) {
                    resolve(obj);
                } else {
                    resolve(null);
                }
            }
        });
    }));

    if (!userInfo) {
        result.code = 17720;
        return result;
    }

    if (userIslandInfo != -1) {
        let dayResidueTimes = await getUserDayChallengeTimes(userID);

        if (userIslandInfo == null) {
            userIslandInfo = {
                updateTime: date,//刷新时间，第几天刷新的
                dayResidueTimes: dayResidueTimes,//今天剩余次数，每日刷新
                dayAddTimes: 0,//今日增加次数，每日刷新
                payOccupyTimes: 0,//购买的最大占领数量，永久保留
                week: getNowTimeStampWeeks(date),//排行榜刷新周
                score: 0,//排行榜分数
            }

            if (userInfo.payOccupyTimes && utils.isNumber(userInfo.payOccupyTimes)) {
                userIslandInfo.payOccupyTimes = parseInt(userInfo.payOccupyTimes);
            }

            if (userInfo.isVIP == 1) {
                userIslandInfo.isVIP = 1;
            }

            await (new Promise(function (resolve, reject) {
                redisClient.hmset(userDBkey, userIslandInfo, function (err, obj) {
                    if (err != null) {
                        logger.error(err);
                        reject(false);
                    } else {
                        resolve(true);
                    }
                });
            }));
        } else {
            if (flag != null) {
                if (changeChannel == 0) {
                    if (userIslandInfo.occupyed && userIslandInfo.occupyed.length > 0) {
                        let tmp_ChannelID = parseInt(userIslandInfo.occupyed[0] / 1000);
                        if (tmp_ChannelID >= islandsPlunder.channelCount) {
                            //所占领岛屿频道已关闭
                            await islandForceSettlement(userID, userIslandInfo, tmp_ChannelID);
                            channelID = openChannel[utils.randomRangeInt(0, openChannel.length)];
                        } else {
                            //直接进入有占领的频道
                            channelID = parseInt(userIslandInfo.occupyed[0] / 1000);
                        }
                    } else if (userIslandInfo.candidate && userIslandInfo.candidate.length > 0) {
                        let tmp_ChannelID = parseInt(userIslandInfo.candidate[0] / 1000);
                        if (tmp_ChannelID >= islandsPlunder.channelCount) {
                            //候补岛屿频道已关闭
                            await islandForceSettlement(userID, userIslandInfo, tmp_ChannelID);
                            channelID = openChannel[utils.randomRangeInt(0, openChannel.length)];
                        } else {
                            //直接进入有候补的频道
                            channelID = parseInt(userIslandInfo.candidate[0] / 1000);
                        }
                    }
                } else {
                    if (parseInt(parseInt(islandID) / 1000) >= islandsPlunder.channelCount) {
                        result.code = 17721;
                        return result;
                    }
                }
            }

            if (userInfo.isVIP == 1 && !userIslandInfo.isVIP) {
                await this.purchaseVIP(userID);
                userIslandInfo.isVIP = 1;
            }

            let nowWeek = getNowTimeStampWeeks(date);
            if (userIslandInfo.week != nowWeek) {
                userIslandInfo.week = nowWeek;
                userIslandInfo.score = 0;
                await updateRankScore(userID, userIslandInfo);
            }

            if (getCurrentDay(date) != getCurrentDay(userIslandInfo.updateTime)) {
                userIslandInfo.updateTime = date;
                userIslandInfo.dayResidueTimes = dayResidueTimes;
                userIslandInfo.dayAddTimes = 0;

                await (new Promise(function (resolve, reject) {
                    redisClient.hset(userDBkey, 'updateTime', userIslandInfo.updateTime, 'dayResidueTimes', userIslandInfo.dayResidueTimes, 'dayAddTimes', userIslandInfo.dayAddTimes, function (err, obj) {
                        if (err != null) {
                            logger.error(err);
                            reject(false);
                        } else {
                            resolve(true);
                        }
                    });
                }));
            }
        }

        if (userIslandInfo.income) {
            redisClient.hdel(userDBkey, 'income');
        }

        if (userIslandInfo.record) {
            redisClient.hdel(userDBkey, 'record');
            for (let index = 0; index < userIslandInfo.record.length; index++) {
                userIslandInfo.record[index].nickName = await matchService.getNickNameByUserID(userIslandInfo.record[index].userID);
            }
        }

        userIslandInfo.NauticalCoin = parseInt(userInfo.NauticalCoin) || 0;
    } else {
        result.code = 17700;
        return result;
    }

    let islands = islandsPlunder.islands;
    let islandsInfo = [];
    let occupyed = userIslandInfo.occupyed || [];
    for (let index = 0; index < islands.length; index++) {
        let islandID = islands[index].id + 1000 * channelID;
        let island = await getIsland(islandID);

        if (island != -1) {
            if (island == null) {
                island = {
                    id: islandID,//岛屿id

                    plunderUserID: -1,//掠夺者userID,-1无掠夺者
                    battleFormation: '',//守护者的阵型
                    plunderTime: 0,//什么时候掠夺的

                    occupyingUserID: -1,//占领中，-1没人
                    occupyStartTime: 0,//什么时候开始占领的
                }
                let tmp = await (new Promise(function (resolve, reject) {
                    let dbkey = 'island:' + islandID;
                    redisClient.hmset(dbkey, island, function (err, obj) {
                        if (err != null) {
                            logger.error(err);
                            reject(-1);
                        } else {
                            resolve(obj);
                        }
                    });
                }));

                if (tmp == -1) {
                    continue;
                }
            } else {
                await isLandHandle(userID, userIslandInfo, island);

                let tmp_Index = occupyed.indexOf(islandID);
                if (island.plunderUserID == userID) {
                    if (tmp_Index == -1) {
                        occupyed.push(islandID);
                    }
                } else {
                    if (tmp_Index != -1 && island.plunderUserID != userID) {
                        occupyed.splice(tmp_Index, 1);
                    }
                }
            }
            islandsInfo.push(getStandardIslandData(island));
        }
    }

    userIslandInfo.occupyed = occupyed;
    await setCurrentOccupyed(userID, userIslandInfo);

    userIslandInfo.occupyLimit = getOccupyLimit(userIslandInfo);
    result.islandsInfo = islandsInfo;
    result.userIslandInfo = userIslandInfo;
    result.islandConfig = {
        occupyOnceMax: islandsPlunder.occupyOnceMax,
        VIPIncrease: islandsPlunder.VIPIncrease,
        increasePay: islandsPlunder.increasePay,
        occupyLimit: islandsPlunder.occupyLimit,
        dayResidueTimes: islandsPlunder.dayResidueTimes,
        monthCardIncrease: islandsPlunder.monthCardIncrease,
        timesPay: islandsPlunder.timesPay,
        diamondsIncreaseLimit: islandsPlunder.diamondsIncreaseLimit,

        candidateMaxCount: islandsPlunder.candidateMaxCount,
        candidateNeedRound: islandsPlunder.candidateNeedRound,
    };
    result.channelID = channelID;
    result.openChannel = openChannel;
    redisClient.expire(userDBkey, MAIL_EXPIRE_TIME);//用户获取全局信息说明用户处于活跃状态，设置过期时间30天
    return result;
}

/**
 * 购买次数
 * @param {*} userID 
 * @param {*} timesType 1掠夺次数，2同时占领个数
 * @returns 
 */
exp.buyTimes = async function (userID, timesType) {
    let retResult = {
        code: 10000
    };

    let userIslandInfo = await getUserIslandInfo(userID);

    if (!userIslandInfo || userIslandInfo == -1) {
        retResult.code = 17701;
        return retResult;
    }

    let needDiamonds = 0;
    if (timesType == 1) {
        let dayResidueTimes = await getUserDayChallengeTimes(userID);
        //掠夺次数
        if (userIslandInfo.dayResidueTimes < dayResidueTimes) {
            let index = userIslandInfo.dayAddTimes;
            if (index > islandsPlunder.timesPay.length - 1) {
                index = islandsPlunder.timesPay.length - 1;
            }
            needDiamonds = islandsPlunder.timesPay[index];
        } else {
            retResult.code = 17703;
            return retResult;
        }
    } else if (timesType == 2) {
        //同时占领个数
        if (userIslandInfo.payOccupyTimes && userIslandInfo.payOccupyTimes >= islandsPlunder.diamondsIncreaseLimit) {
            retResult.code = 17716;
            return retResult;
        }

        if (getOccupyLimit(userIslandInfo) < islandsPlunder.occupyLimit) {
            needDiamonds = islandsPlunder.increasePay;
        } else {
            retResult.code = 17704;
            return retResult;
        }
    } else {
        retResult.code = 17702;
        return retResult;
    }

    //查询是否有足够的钻石
    let iDiamonds = 0;
    await goodsDao.getGoodsbByUserIDQ(userID).then(goods => {
        if (!goods || goods.length <= 0) {
            retResult.code = 10774;
        } else {
            iDiamonds = goods[0].diamonds;
            if (iDiamonds < 0) {
                retResult.code = 10775;
            }
        }
    }).catch(err => {
        retResult.code = 10032;
    });

    if (retResult.code != 10000) {
        return retResult;
    }

    if (needDiamonds > iDiamonds) {
        retResult.code = 10101;
        return retResult;
    };

    await goodsDao.consumeDiamondsQ(userID, needDiamonds).then(data => {
        if (!data.affectedRows || data.affectedRows != 1) {
            retResult.code = 10106;
        }
    }).catch(err => {
        retResult.code = 10034;
    });

    if (retResult.code != 10000) {
        return retResult;
    }

    let strDesc = '';
    if (timesType == 1) {
        strDesc = '增加岛屿掠夺次数';
        userIslandInfo.dayResidueTimes += 1;
        userIslandInfo.dayAddTimes += 1;
        await (new Promise(function (resolve, reject) {
            redisClient.hset('userIslandInfo:' + userID, 'dayResidueTimes', userIslandInfo.dayResidueTimes, 'dayAddTimes', userIslandInfo.dayAddTimes, function (err, obj) {
                if (err != null) {
                    logger.error(err);
                    reject(false);
                } else {
                    resolve(true);
                }
            });
        }));
    } else if (timesType == 2) {
        strDesc = '增加同时占领岛屿个数';
        userIslandInfo.payOccupyTimes += 1;
        userIslandInfo.occupyLimit = getOccupyLimit(userIslandInfo);
        await (new Promise(function (resolve, reject) {
            redisClient.hset('userIslandInfo:' + userID, 'payOccupyTimes', userIslandInfo.payOccupyTimes, function (err, obj) {
                if (err != null) {
                    logger.error(err);
                    reject(false);
                } else {
                    resolve(true);
                }
            });
        }));
        await (new Promise(function (resolve, reject) {
            redisClient.hset('userinfo:' + userID, 'payOccupyTimes', userIslandInfo.payOccupyTimes, function (err, str) {
                if (err != null) {
                    logger.error(err);
                    reject(false);
                } else {
                    resolve(true);
                }
            });
        }));
    }
    goodsDao.createConsume(userID, "diamonds", needDiamonds, strDesc);

    retResult.userIslandInfo = userIslandInfo;
    return retResult;
}

/**
 * 获取岛屿信息
 */
exp.getIslandInfo = async function (userID, islandID, getIncome, getBattleFormation) {
    getBattleFormation = getBattleFormation || 0;//获取阵容 0 1获取，2不获取

    let result = {
        code: 10000,
    }

    if (parseInt(parseInt(islandID) / 1000) >= islandsPlunder.channelCount) {
        result.code = 17721;
        return result;
    }

    let userIslandInfo = await getUserIslandInfo(userID);

    if (userIslandInfo == -1 || !userIslandInfo) {
        result.code = 17705;
        return result;
    }

    let island = await getIsland(islandID);
    if (island != -1 && island) {
        if (island.plunderUserID != -1) {
            island.head = await getHeadInfo(island.plunderUserID);
        }

        if (getIncome == 1) {
            await isLandHandle(userID, userIslandInfo, island);

            let resultIncome = [];
            let income = [];
            let resultRecord = [];
            let record = [];
            if (userIslandInfo.income) {
                for (let index = 0; index < userIslandInfo.income.length; index++) {
                    if (userIslandInfo.income[index].islandID == islandID) {
                        resultIncome.push(userIslandInfo.income[index]);
                    } else {
                        income.push(userIslandInfo.income[index]);
                    }
                }
            }
            if (userIslandInfo.record) {
                for (let index = 0; index < userIslandInfo.record.length; index++) {
                    if (userIslandInfo.record[index].islandID == islandID) {
                        resultRecord.push(userIslandInfo.record[index]);
                    } else {
                        record.push(userIslandInfo.record[index]);
                    }
                }
            }
            await (new Promise(function (resolve, reject) {
                redisClient.hset('userIslandInfo:' + userID, 'income', JSON.stringify(income), 'record', JSON.stringify(record), function (err, obj) {
                    if (err != null) {
                        logger.error(err);
                        reject(false);
                    } else {
                        resolve(true);
                    }
                });
            }));

            userIslandInfo.income = resultIncome;
            userIslandInfo.record = resultRecord;
        } else {
            await isLandHandle(-1, null, island);
            if (userIslandInfo.income) {
                delete userIslandInfo.income;
            }
            if (userIslandInfo.record) {
                delete userIslandInfo.record;
            }
        }

        if (island.candidate) {
            delete island.candidate;
        }
        if (getBattleFormation == 2) {
            if (island.battleFormation) {
                delete island.battleFormation;
            }
        }
        result.island = island;
        result.userIslandInfo = userIslandInfo;
        result.curTime = Date.now();
    } else {
        result.code = 17706;
    }

    return result;
}

/**
 * 占领岛屿
 */
exp.occupyIsland = async function (userID, islandID, challengeType) {
    challengeType = challengeType || 0;//0 1挑战，2候补

    let result = {
        code: 10000,
    }

    if (parseInt(parseInt(islandID) / 1000) >= islandsPlunder.channelCount) {
        result.code = 17721;
        return result;
    }

    let matchItem = await getCurMatchInfo();
    if (!matchItem) {
        result.code = 17715;
        return result;
    }

    if (getMatchStatus(matchItem) == 3) {
        //维护
        result.code = 40000;
        return result;
    }

    let dateTime = new Date();
    if (dateTime.getHours() < 6) {
        //0-6点禁止争夺
        result.code = 30000;
        return result;
    }

    let userIslandInfo = await getUserIslandInfo(userID);

    if (userIslandInfo == -1 || !userIslandInfo) {
        result.code = 17705;
        return result;
    }

    if (userIslandInfo.dayResidueTimes <= 0) {
        result.code = 17708;
        return result;
    }

    let occupyLimit = getOccupyLimit(userIslandInfo);
    let userTiems = userIslandInfo.occupyed.length;
    if (userIslandInfo.candidate) {
        userTiems += userIslandInfo.candidate.length;
    }
    if (userTiems >= occupyLimit) {
        result.code = 17709;
        return result;
    }

    let occupyed = userIslandInfo.occupyed;
    let occupyedChannel = -1;
    let candidateChannel = -1;
    for (let index = 0; index < occupyed.length; index++) {
        occupyedChannel = parseInt(occupyed[index] / 1000);
        if (occupyedChannel != parseInt(parseInt(islandID) / 1000)) {
            //只能占领一个频道内的岛屿
            result.code = 17717;
            return result;
        }
    }

    if (userIslandInfo.candidate) {
        for (let index = 0; index < userIslandInfo.candidate.length; index++) {
            candidateChannel = parseInt(userIslandInfo.candidate[index] / 1000);
            if (challengeType == 2) {
                if (candidateChannel != parseInt(parseInt(islandID) / 1000)) {
                    //只能占领一个频道内的岛屿
                    result.code = 17730;
                    return result;
                } else if (userIslandInfo.candidate[index] == islandID) {
                    //已在候补席
                    result.code = 17723;
                    return result;
                }
            }
        }

        // if (challengeType == 2 && userIslandInfo.candidate.length >= islandsPlunder.occupyLimit) {
        //     //候补已达上限
        //     result.code = 17732;
        //     return result;
        // }
    }

    if (occupyedChannel != -1 && candidateChannel != -1 && occupyedChannel != candidateChannel) {
        //只能占领一个频道内的岛屿
        result.code = 17731;
        return result;
    }

    let date = Date.now();
    let island = await getIsland(islandID);
    let islandConfig = getIslandConfig(islandID);
    if (island != -1 && island) {
        await isLandHandle(-1, null, island);

        if (challengeType == 0 || challengeType == 1) {
            //攻打占领
            if (island.plunderUserID != -1) {
                //有人占领
                if (island.plunderUserID == userID) {
                    //自己占领的岛屿
                    result.code = 17722;
                } else if (date - island.plunderTime < islandConfig.guardTime * 60000) {
                    //保护期
                    result.code = 17707;
                } else if (island.occupyingUserID == -1) {
                    //抢占他人
                    result.code = 20000;
                    await changeIslandInfo(island.id, island.plunderUserID, island.battleFormation, island.plunderTime, userID, date);
                } else {
                    //有人正在攻打
                    result.code = 20008;
                }
            } else if (island.occupyingUserID != -1) {
                //有人正在攻打
                result.code = 20008;
            } else {
                //可占领
                await changeIslandInfo(island.id, -1, null, 0, userID, date);
            }
        } else if (challengeType == 2) {
            //候补
            if (island.plunderUserID != -1) {
                await getIslandCandidateInfo(island);
                let islandConfig = getIslandConfig(island.id);
                let candidateTiem = parseInt(island.plunderTime) + islandConfig.guardTime * 60000;//候补时间
                if (date < (candidateTiem - 5 * 60000)) {
                    if (island.candidate && island.candidate.length > 0) {
                        for (let index = 0; index < island.candidate.length; index++) {
                            if (island.candidate[index].userID == userID) {
                                //已在候补席
                                result.code = 17723;
                                break;
                            }
                        }
                    }

                    if (result.code != 10000) {
                        return result;
                    }
                } else {
                    //保护期最后5分钟不能候补
                    result.code = 17734;
                    return result;
                }
            } else {
                //未知错误，不能候补
                result.code = 17735;
                return result;
            }
        }

        if (island.candidate) {
            delete island.candidate;
        }
        result.island = island;
    } else {
        result.code = 17706;
    }

    return result;
}

/**
 * 占领情况上报
 */
exp.occupyIslandResult = async function (userID, data) {
    if (typeof data == 'string') {
        try {
            data = JSON.parse(data);
        } catch (error) {
            console.error(error);
        }
    }
    let islandID = data.islandID;
    let occupyResult = data.result;
    let challengeType = data.challengeType || 0;//0 1挑战，2候补

    let result = {
        code: 10000,
    }

    if (parseInt(parseInt(islandID) / 1000) >= islandsPlunder.channelCount) {
        result.code = 17721;
        return result;
    }

    let userIslandInfo = await getUserIslandInfo(userID);

    if (userIslandInfo == -1 || !userIslandInfo) {
        result.code = 17711;
        return result;
    }

    let island = await getIsland(islandID);
    if (island == -1 || !island) {
        result.code = 17710;
        return result;
    }

    let date = Date.now();
    if (challengeType == 0 || challengeType == 1) {
        //占领
        if (island.occupyingUserID != userID) {
            //不是本人的上报
            result.code = 17713;
            return result;
        }

        if (island.plunderUserID == userID) {
            //重复上报
            result.code = 17714;
            return result;
        }

        if (island.plunderUserID != -1) {
            await addRecord(island.plunderUserID, island, userID, occupyResult);
        }

        if (occupyResult == 1) {
            if (island.plunderUserID != -1) {
                userIslandInfo.score = await reportRankScore(userID, 10 + 5);//3、主动进攻，并成功击败他人一次，可获得5积分；
                result.harvest = await addIncome(island.plunderUserID, island, userID, 2);

                //================================
                let tmp_UserIslandInfo = await getUserIslandInfo(island.plunderUserID);

                if (tmp_UserIslandInfo != -1 && tmp_UserIslandInfo) {
                    if (tmp_UserIslandInfo.occupyed) {
                        for (let index = 0; index < tmp_UserIslandInfo.occupyed.length; index++) {
                            if (tmp_UserIslandInfo.occupyed[index] == islandID) {
                                tmp_UserIslandInfo.occupyed.splice(index, 1);
                                index--;
                            }
                        }
                        await setCurrentOccupyed(island.plunderUserID, tmp_UserIslandInfo);
                    }
                }
                //================================
            } else {
                userIslandInfo.score = await reportRankScore(userID, 10);//1、成功占领一个岛屿获得10积分；
            }

            let battleFormation = data.battleFormation;
            await changeIslandInfo(islandID, userID, battleFormation, date);

            island.plunderUserID = userID;
            island.battleFormation = battleFormation;
            island.plunderTime = date;
            island.occupyingUserID = -1;
            island.occupyStartTime = 0;

            if (island.plunderUserID != -1) {
                island.plunderNickname = await matchService.getNickNameByUserID(island.plunderUserID);
            }
            if (island.battleFormation && island.battleFormation.combat) {
                island.combat = island.battleFormation.combat;
            } else {
                island.combat = -1;
            }

            if (!userIslandInfo.occupyed) {
                userIslandInfo.occupyed = [];
            }
            userIslandInfo.occupyed.push(islandID);
            userIslandInfo.dayResidueTimes -= 1;
            await (new Promise(function (resolve, reject) {
                redisClient.hset('userIslandInfo:' + userID, 'dayResidueTimes', userIslandInfo.dayResidueTimes, 'occupyed', JSON.stringify(userIslandInfo.occupyed), function (err, obj) {
                    if (err != null) {
                        logger.error(err);
                        reject(false);
                    } else {
                        resolve(true);
                    }
                });
            }));
            result.island = island;
            result.userIslandInfo = userIslandInfo;

            if (data.head) {
                let head = {
                    head: 10,
                    headRing: 0,
                }
                if (data.head.heroID) {
                    head.head = data.head.heroID
                }

                if (data.head.headRing) {
                    head.headRing = data.head.headRing
                }
                redisClient.hset('userinfo:' + userID, 'head', JSON.stringify(head));
            }
        } else if (occupyResult == 2) {
            island.occupyingUserID = -1;
            island.occupyStartTime = 0;
            result.island = island;
            result.userIslandInfo = userIslandInfo;
            await changeIslandInfo(islandID, island.plunderUserID, island.battleFormation, island.plunderTime, -1, 0);
            if (island.plunderUserID != -1) {
                await reportRankScore(island.plunderUserID, 2);//4、防守成功一次可获得2积分。
            }
        }

        if (result.island.candidate) {
            delete result.island.candidate;
        }
    } else if (challengeType == 2) {
        //=======================候补=======================
        if (data.round == null || data.hpPercent == null || data.battleFormation == null) {
            result.code = 81954;
            return result;
        }

        if (!userIslandInfo.candidate) {
            userIslandInfo.candidate = [];
        }
        if (userIslandInfo.occupyed.length + userIslandInfo.candidate.length >= getOccupyLimit(userIslandInfo)) {
            //占领已达上限
            result.code = 17709;
            return result;
        }

        await getIslandCandidateInfo(island);
        if (island.candidate && island.candidate.length > 0) {
            for (let index = 0; index < island.candidate.length; index++) {
                if (island.candidate[index].userID == userID) {
                    //已在候补席
                    result.code = 17723;
                    return result;
                }
            }
        }

        let round = parseInt(data.round);
        let hpPercent = parseInt(data.hpPercent);//打了多少血
        let add = false;//能否进候补队列
        if (occupyResult == 1) {
            //打赢岛主
            add = true;
        } else if (round >= islandsPlunder.candidateNeedRound) {
            //攻打失败,但满足候补所需回合数
            add = true;
        }

        if (add) {
            //加入候补队列
            if (!island.candidate) {
                island.candidate = [];
            }
            let obj = {
                userID: userID,
                result: occupyResult,
                round: round,
                hpPercent: hpPercent,
                combat: data.battleFormation.combat,
                date: date,
            }
            obj.nickName = await matchService.getNickNameByUserID(userID);
            let head = await getHeadInfo(userID);
            obj.head = head.head;
            obj.headRing = head.headRing;
            if (occupyResult == 1) {
                obj.battleFormation = data.battleFormation;
            }
            island.candidate.push(obj);

            let deleteUser = [];
            if (island.candidate.length > islandsPlunder.candidateMaxCount) {
                candidateSort(island);
                let tmp_UserIslandInfo;
                //删除多余的
                for (let i = islandsPlunder.candidateMaxCount; i < island.candidate.length; i++) {
                    deleteUser.push(island.candidate[i].userID);
                    tmp_UserIslandInfo = await getUserIslandInfo(island.candidate[i].userID);
                    if (tmp_UserIslandInfo != -1 && tmp_UserIslandInfo) {
                        if (tmp_UserIslandInfo.candidate) {
                            for (let j = 0; j < tmp_UserIslandInfo.candidate.length; j++) {
                                if (tmp_UserIslandInfo.candidate[j] == islandID) {
                                    tmp_UserIslandInfo.candidate.splice(j, 1);
                                    j--;
                                }
                            }
                            await setCurrentCandidate(island.candidate[i].userID, tmp_UserIslandInfo);
                        }
                    }

                    island.candidate.splice(i, 1);
                    i--;
                }
            }

            //追加自己的候补信息记录
            if (deleteUser.indexOf(userID) == -1) {
                userIslandInfo.candidate.push(islandID);

                await setCurrentCandidate(userID, userIslandInfo);
                await setIslandCandidateInfo(island);

                if (data.head) {
                    let head = {
                        head: 10,
                        headRing: 0,
                    }
                    if (data.head.heroID) {
                        head.head = data.head.heroID
                    }

                    if (data.head.headRing) {
                        head.headRing = data.head.headRing
                    }
                    redisClient.hset('userinfo:' + userID, 'head', JSON.stringify(head));
                }

                //扣除每日次数
                userIslandInfo.dayResidueTimes -= 1;
                await (new Promise(function (resolve, reject) {
                    redisClient.hset('userIslandInfo:' + userID, 'dayResidueTimes', userIslandInfo.dayResidueTimes, function (err, obj) {
                        if (err != null) {
                            logger.error(err);
                            reject(false);
                        } else {
                            resolve(true);
                        }
                    });
                }));
            } else {
                //未能进入候补
                result.code = 17736;
            }
        } else {
            //未能进入候补
            result.code = 17736;
        }

        result.island = island;
        result.userIslandInfo = userIslandInfo;

        if (island.candidate && island.candidate.length > 0) {
            for (let index = 0; index < island.candidate.length; index++) {
                if (island.candidate[index].battleFormation) {
                    delete island.candidate[index].battleFormation;
                }
            }
        }
        if (island.battleFormation) {
            delete island.battleFormation;
        }
    }

    if (island.plunderUserID != -1) {
        island.head = await getHeadInfo(island.plunderUserID);
    }

    result.date = date;
    return result;
}

/**
 * 主动取消掠夺
 */
exp.cancelIslandOccupy = async function (userID, islandID) {
    let result = {
        code: 10000,
    }
    let userIslandInfo = await getUserIslandInfo(userID);

    if (userIslandInfo == -1 || !userIslandInfo) {
        result.code = 17712;
        return result;
    }

    let island = await getIsland(islandID);
    if (island == -1 || !island) {
        result.code = 17714;
        return result;
    }

    await isLandHandle(userID, userIslandInfo, island);

    if (island.plunderUserID == -1 || island.plunderUserID != userID) {
        //掠夺结束 或 被他人抢占
        if (userIslandInfo.income || userIslandInfo.record) {
            let resultIncome = [];
            let income = [];
            let resultRecord = [];
            let record = [];
            if (userIslandInfo.income) {
                for (let index = 0; index < userIslandInfo.income.length; index++) {
                    if (userIslandInfo.income[index].islandID == islandID) {
                        resultIncome.push(userIslandInfo.income[index]);
                    } else {
                        income.push(userIslandInfo.income[index]);
                    }
                }
            }
            if (userIslandInfo.record) {
                for (let index = 0; index < userIslandInfo.record.length; index++) {
                    if (userIslandInfo.record[index].islandID == islandID) {
                        resultRecord.push(userIslandInfo.record[index]);
                        if (userIslandInfo.record[index].result == 1) {
                            result.code = 20000;//被他人抢占
                        }
                    } else {
                        record.push(userIslandInfo.record[index]);
                    }
                }
            }
            await (new Promise(function (resolve, reject) {
                redisClient.hset('userIslandInfo:' + userID, 'income', JSON.stringify(income), 'record', JSON.stringify(record), function (err, obj) {
                    if (err != null) {
                        logger.error(err);
                        reject(false);
                    } else {
                        resolve(true);
                    }
                });
            }));

            userIslandInfo.income = resultIncome;
            userIslandInfo.record = resultRecord;
        }
    } else if (island.plunderUserID == userID) {
        let plunderTime = island.plunderTime;
        await addIncome(userID, island, -2, 0, Date.now(), userIslandInfo);
        await changeIslandInfo(island.id, -1, null, 0, island.occupyingUserID, island.occupyStartTime);
        island.plunderUserID = -1;
        island.plunderTime = 0;
        if (island.battleFormation) {
            delete island.battleFormation;
        }

        if (userIslandInfo != -1 && userIslandInfo) {
            if (userIslandInfo.occupyed) {
                for (let index = 0; index < userIslandInfo.occupyed.length; index++) {
                    if (userIslandInfo.occupyed[index] == islandID) {
                        userIslandInfo.occupyed.splice(index, 1);
                        index--;
                    }
                }
                await setCurrentOccupyed(userID, userIslandInfo);
            }
        }

        let tmp_Island = await getIsland(islandID);
        if (tmp_Island != -1 && tmp_Island) {
            tmp_Island.plunderTime = plunderTime;
            await candidateUp(-1, null, tmp_Island, true);
        }
    }

    if (island.candidate) {
        delete island.candidate;
    }
    if (island.battleFormation) {
        delete island.battleFormation;
    }

    result.userIslandInfo = userIslandInfo;
    result.island = island;
    return result;
}

/**
 * 碎片兑换航海硬币
 */
exp.exchangeNauticalCoin = async function (userID, exchangeCount, token) {
    let result = { code: 10000 };

    //if (!isNaN(parseInt(exchangeCount)) && isFinite(exchangeCount)) 
    if (isNaN(parseInt(exchangeCount)) || !isFinite(exchangeCount) || typeof token != 'string' || token.length != 32) {
        result.code = 17731;
        return result;
    }

    //校验token
    //token格式：32位，全部16进制，前四位随机数，最后四位随机，中间24位为自身原有数量、增加数量、8位随机码的穿插混合
    let newToken = token.substring(4, 28);
    let selfCount = '';
    let addCount = '';

    for (let index = 0; index < newToken.length; index += 3) {
        if ((newToken[index] >= '0' && newToken[index] <= '9') || (newToken[index] >= 'a' && newToken[index] <= 'f')) {
            selfCount += newToken[index].toString();
        }
    }
    for (let index = 1; index < newToken.length; index += 3) {
        if ((newToken[index] >= '0' && newToken[index] <= '9') || (newToken[index] >= 'a' && newToken[index] <= 'f')) {
            addCount += newToken[index].toString();
        }
    }

    selfCount = utils.toDecimalNumber(selfCount, 16);
    addCount = utils.toDecimalNumber(addCount, 16);

    if (addCount != exchangeCount) {
        //token中的增加数量与请求体中的增加数量不一致
        result.code = 17732;
        return result;
    }

    let tmp_SelfCount = await (new Promise(function (resolve, reject) {
        redisClient.hget('userinfo:' + userID, 'NauticalCoin', function (err, str) {
            if (err != null) {
                reject(0);
                logger.error(err);
            } else {
                resolve(str || 0);
            }
        });
    }));

    if (selfCount != tmp_SelfCount) {
        //token中的原本数量与实际拥有数量不一致
        result.code = 17733;
        result.count = tmp_SelfCount;
        return result;
    }

    await (new Promise(function (resolve, reject) {
        let dbkey = 'userinfo:' + userID;
        redisClient.hincrby(dbkey, 'NauticalCoin', exchangeCount, function (err, str) {
            if (err != null) {
                reject(0);
                logger.error(err);
                result.code = 17730;
            } else {
                result.count = exchangeCount;
                resolve(exchangeCount);
            }
        });
    }));
    return result;
}

/**
 * 购买VIP
 */
exp.purchaseVIP = async function (userID) {
    return await (new Promise(function (resolve, reject) {
        redisClient.hset('userIslandInfo:' + userID, 'isVIP', 1, function (err, obj) {
            if (err != null) {
                logger.error(err);
                reject(false);
            } else {
                resolve(true);
            }
        });
    }));
}

/**
 * 购买月卡
 */
exp.purchaseMonthCard = async function (userID) {
    let userIslandInfo = await getUserIslandInfo(userID);

    if (userIslandInfo && userIslandInfo != -1) {
        if (userIslandInfo.dayResidueTimes < islandsPlunder.dayResidueTimes + islandsPlunder.monthCardIncrease) {
            userIslandInfo.dayResidueTimes += 1;
            await (new Promise(function (resolve, reject) {
                redisClient.hset('userIslandInfo:' + userID, 'dayResidueTimes', userIslandInfo.dayResidueTimes, function (err, obj) {
                    if (err != null) {
                        logger.error(err);
                        reject(false);
                    } else {
                        resolve(true);
                    }
                });
            }));
        }
    }
}

/**
 * 获取候补信息
 * @param {*} userID 
 * @param {*} islandID 
 */
exp.getCandidateInfo = async function (userID, islandID) {
    let userIslandInfo = await getUserIslandInfo(userID);

    let result = { code: 10000 };
    if (!userIslandInfo || userIslandInfo == -1) {
        result.code = 15950;
        return result;
    }

    if (parseInt(parseInt(islandID) / 1000) >= islandsPlunder.channelCount) {
        result.code = 17721;
        return result;
    }

    let island = await getIsland(islandID);
    if (island != -1 && island) {
        await isLandHandle(-1, null, island);

        await getIslandCandidateInfo(island);
        if (island.candidate && island.candidate.length > 0) {
            for (let index = 0; index < island.candidate.length; index++) {
                if (island.candidate[index].battleFormation) {
                    delete island.candidate[index].battleFormation;
                }
            }
        }
        if (island.battleFormation) {
            delete island.battleFormation;
        }
        result.island = island;
    } else {
        result.code = 17706;
    }

    return result;
}

/**
 * 取消候补
 * @param {*} userID 
 * @param {*} islandID 
 */
exp.cancelCandidateInfo = async function (userID, islandID) {
    let userIslandInfo = await getUserIslandInfo(userID);

    let result = { code: 10000 };
    if (!userIslandInfo || userIslandInfo == -1) {
        result.code = 15950;
        return result;
    }

    if (!userIslandInfo.candidate || userIslandInfo.candidate.length == 0 || userIslandInfo.candidate.indexOf(islandID) == -1) {
        result.code = 17740;
        return result;
    }

    let island = await getIsland(islandID);
    if (island != -1 && island) {
        await getIslandCandidateInfo(island);
        if (island.candidate && island.candidate.length > 0) {
            let has = false;
            for (let index = 0; index < island.candidate.length; index++) {
                if (island.candidate[index].battleFormation) {
                    delete island.candidate[index].battleFormation;
                }
                if (island.candidate[index].userID == userID) {
                    has = true;
                    island.candidate.splice(index, 1);
                    index--;
                }
            }

            if (has) {
                for (let index = 0; index < userIslandInfo.candidate.length; index++) {
                    if (userIslandInfo.candidate[index] == islandID) {
                        userIslandInfo.candidate.splice(index, 1);
                        break;
                    }
                }

                await setCurrentCandidate(userID, userIslandInfo);
                await setIslandCandidateInfo(island);
            } else {
                result.code = 17741;
            }
        } else {
            result.code = 17741;
        }

        if (island.battleFormation) {
            delete island.battleFormation;
        }
        result.island = island;
        result.userIslandInfo = userIslandInfo;
    } else {
        result.code = 17706;
    }

    result.date = Date.now();
    return result;
}

/**
 * 处理岛屿
 * @param {*} userID 与userIslandInfo对应
 * @param {*} userIslandInfo 与userID对应
 * @param {*} island 
 */
let isLandHandle = async function (userID, userIslandInfo, island) {
    let islandConfig = getIslandConfig(island.id);
    let date = Date.now();

    if (island.plunderUserID != -1) {
        //这座岛正在被plunderUserID掠夺

        await candidateUp(userID, userIslandInfo, island).then(data => { }).catch(error => console.log(error));

        if (date - parseInt(island.plunderTime) >= islandConfig.maxPlunderTime * 60000) {
            //掠夺时间到了
            if (userID != -1 && island.plunderUserID == userID) {
                if (!userIslandInfo.income) {
                    userIslandInfo.income = [];
                }
                userIslandInfo.income.push({
                    islandID: island.id,//岛屿id
                    occupyTime: islandConfig.maxPlunderTime,//占领了多久
                    userID: -1,
                    date: date,
                });
            } else {
                await addIncome(island.plunderUserID, island, -1, 1);
            }

            let plunderUserID = island.plunderUserID;
            await changeIslandInfo(island.id, -1, null, 0, island.occupyingUserID, island.occupyStartTime);
            await reportRankScore(island.plunderUserID, islandConfig.score);//岛屿掠夺完成时上报积分
            island.plunderUserID = -1;
            island.battleFormation = {};
            island.plunderTime = 0;

            let tmp_UserIslandInfo;
            if (userID != -1 && userID == plunderUserID) {
                tmp_UserIslandInfo = userIslandInfo;
            } else {
                tmp_UserIslandInfo = await getUserIslandInfo(plunderUserID);
            }

            if (tmp_UserIslandInfo != -1 && tmp_UserIslandInfo && tmp_UserIslandInfo.occupyed) {
                for (let index = 0; index < tmp_UserIslandInfo.occupyed.length; index++) {
                    if (tmp_UserIslandInfo.occupyed[index] == island.id) {
                        tmp_UserIslandInfo.occupyed.splice(index, 1);
                        index--;
                    }
                }
                await setCurrentOccupyed(plunderUserID, tmp_UserIslandInfo);
            }
        }
    }

    if (island.occupyingUserID != -1) {
        //正在被攻打
        if (date - island.occupyStartTime > islandsPlunder.maxFightTime * 1000) {
            //攻打超时
            await changeIslandInfo(island.id, island.plunderUserID, island.battleFormation, island.plunderTime, -1, 0);
            island.occupyingUserID = -1;
            island.occupyStartTime = 0;
        }
    }
}

/**
 * 候补上位
 * @param {*} userID 
 * @param {*} userIslandInfo 
 * @param {*} island 
 * @param {*} cancelIslandOccupy 主动取消掠夺
 */
let candidateUp = async function (userID, userIslandInfo, island, cancelIslandOccupy) {
    let islandConfig = getIslandConfig(island.id);
    let date = Date.now();

    if ((cancelIslandOccupy || (date - parseInt(island.plunderTime)) >= islandConfig.guardTime * 60000)) {
        await getIslandCandidateInfo(island);
        if (island.candidate && island.candidate.length > 0) {
            //=============候补上位=============

            let candidateTiem = parseInt(island.plunderTime) + islandConfig.guardTime * 60000;//候补时间

            if (cancelIslandOccupy) {
                candidateTiem = date;
            }

            let loss = 0;
            let candidateInfo = await getMainCandidate(island);

            if (candidateInfo) {
                //候补记录，奖励/战绩
                if (island.plunderUserID != -1) {
                    if (userID != -1 && island.plunderUserID == userID) {
                        //自己被候补
                        loss = await addIncome(island.plunderUserID, island, island.plunderUserID, 3, candidateTiem, userIslandInfo);
                        await addRecord(island.plunderUserID, island, island.plunderUserID, 1, candidateTiem, userIslandInfo, 1);
                    } else {
                        //别人被候补
                        loss = await addIncome(island.plunderUserID, island, island.plunderUserID, 3, candidateTiem);
                        await addRecord(island.plunderUserID, island, island.plunderUserID, 1, candidateTiem, null, 1);
                    }
                }

                let plunderUserID = island.plunderUserID;
                await changeIslandInfo(island.id, candidateInfo.userID, candidateInfo.battleFormation, candidateTiem, island.occupyingUserID, island.occupyStartTime);

                let currentScore = await reportRankScore(candidateInfo.userID, 10 + 5);
                if (userID != -1 && candidateInfo.userID == userID) {
                    userIslandInfo.score = currentScore;
                }

                island.plunderUserID = candidateInfo.userID;
                island.battleFormation = candidateInfo.battleFormation;
                island.plunderTime = candidateTiem;

                if (island.plunderUserID != -1) {
                    island.plunderNickname = await matchService.getNickNameByUserID(island.plunderUserID);
                }
                if (island.battleFormation && island.battleFormation.combat) {
                    island.combat = island.battleFormation.combat;
                } else {
                    island.combat = -1;
                }

                let tmp_UserIslandInfo;
                let tmp_UserID;

                if (plunderUserID != -1) {
                    //删除原岛主占领的岛屿列表
                    if (userID != -1 && plunderUserID == userID) {
                        tmp_UserID = plunderUserID;
                        tmp_UserIslandInfo = userIslandInfo;
                    } else {
                        tmp_UserID = plunderUserID;
                        tmp_UserIslandInfo = await getUserIslandInfo(plunderUserID);
                    }
                    if (tmp_UserIslandInfo != -1 && tmp_UserIslandInfo && tmp_UserIslandInfo.occupyed) {
                        for (let index = 0; index < tmp_UserIslandInfo.occupyed.length; index++) {
                            if (tmp_UserIslandInfo.occupyed[index] == island.id) {
                                tmp_UserIslandInfo.occupyed.splice(index, 1);
                                index--;
                            }
                        }
                        await setCurrentOccupyed(plunderUserID, tmp_UserIslandInfo);
                    }
                }

                //修改上位者占领情况
                if (candidateInfo.userID == userID) {
                    tmp_UserID = candidateInfo.userID;
                    tmp_UserIslandInfo = userIslandInfo;
                } else {
                    tmp_UserID = candidateInfo.userID;
                    tmp_UserIslandInfo = await getUserIslandInfo(tmp_UserID);
                }
                if (tmp_UserIslandInfo != -1 && tmp_UserIslandInfo) {
                    if (!tmp_UserIslandInfo.occupyed) {
                        tmp_UserIslandInfo.occupyed = [];
                    }
                    tmp_UserIslandInfo.occupyed.push(island.id);
                    await setCurrentOccupyed(tmp_UserID, tmp_UserIslandInfo);
                }
            }

            if (island.candidate && island.candidate.length > 0) {
                //候补奖励
                let tmp_UserIslandInfo;
                let tmp_UserID;

                for (let index = 0; index < island.candidate.length; index++) {
                    let time = candidateTiem - parseInt(island.candidate[index].date);

                    if (candidateInfo && island.candidate[index].userID == candidateInfo.userID) {
                        //候补上位奖励
                        if (userID != -1 && island.candidate[index].userID == userID) {
                            //自己候补上位
                            tmp_UserID = island.candidate[index].userID;
                            tmp_UserIslandInfo = userIslandInfo;
                            await addIncome(tmp_UserID, island, tmp_UserID, 4, candidateTiem, userIslandInfo, loss + time);
                        } else {
                            //别人候补上位
                            tmp_UserID = island.candidate[index].userID;
                            tmp_UserIslandInfo = await getUserIslandInfo(tmp_UserID);
                            await addIncome(tmp_UserID, island, tmp_UserID, 4, candidateTiem, null, loss + time);
                        }
                    } else {
                        //伪候补奖励
                        if (userID != -1 && island.candidate[index].userID == userID) {
                            tmp_UserID = island.candidate[index].userID;
                            tmp_UserIslandInfo = userIslandInfo;
                            if (tmp_UserIslandInfo != -1 && tmp_UserIslandInfo) {
                                let type = 5;
                                if (island.candidate[index].result != 1) {
                                    type = 6;
                                }
                                await addIncome(tmp_UserID, island, tmp_UserID, type, candidateTiem, tmp_UserIslandInfo, time);
                            }
                        } else {
                            tmp_UserID = island.candidate[index].userID;
                            tmp_UserIslandInfo = await getUserIslandInfo(tmp_UserID);
                            if (tmp_UserIslandInfo != -1 && tmp_UserIslandInfo) {
                                let type = 5;
                                if (island.candidate[index].result != 1) {
                                    type = 6;
                                }
                                await addIncome(tmp_UserID, island, tmp_UserID, type, candidateTiem, null, time);
                            }
                        }
                    }

                    if (tmp_UserIslandInfo != -1 && tmp_UserIslandInfo) {
                        if (tmp_UserIslandInfo.candidate) {
                            for (let index = 0; index < tmp_UserIslandInfo.candidate.length; index++) {
                                if (tmp_UserIslandInfo.candidate[index] == island.id) {
                                    tmp_UserIslandInfo.candidate.splice(index, 1);
                                    index--;
                                }
                            }
                            await setCurrentCandidate(tmp_UserID, tmp_UserIslandInfo);
                        }
                    }
                }

                island.candidate = [];
                await setIslandCandidateInfo(island);
            }
        }
    }
}

/**
 * 频道关闭时强行结算
 */
let islandForceSettlement = async function (userID, userIslandInfo, channelID) {
    let islandID;
    let island;
    let date = Date.now();

    if (channelID >= islandsPlunder.channelCount) {
        let islands = islandsPlunder.islands;
        let tmp_UserID;
        let tmp_UserIslandInfo;
        let islandConfig;
        for (let index = 0; index < islands.length; index++) {
            islandID = islands[index].id + 1000 * channelID;
            island = await getIsland(islandID);

            if (island != -1 && island) {
                //结算候补
                await getIslandCandidateInfo(island);
                if (island.candidate && island.candidate.length > 0) {
                    if (island.plunderTime != -1) {
                        for (let j = 0; j < island.candidate.length; j++) {
                            islandConfig = getIslandConfig(islandID);

                            let candidateTiem = parseInt(island.plunderTime) + islandConfig.guardTime * 60000;//候补时间
                            if (candidateTiem > date) {
                                candidateTiem = date;
                            }
                            let time = candidateTiem - parseInt(island.candidate[j].date);

                            if (island.candidate[j].userID == userID) {
                                tmp_UserID = island.candidate[j].userID;
                                tmp_UserIslandInfo = userIslandInfo;
                                if (tmp_UserIslandInfo != -1 && tmp_UserIslandInfo) {
                                    await addIncome(tmp_UserID, island, -1, 6, candidateTiem, tmp_UserIslandInfo, time);
                                }
                            } else {
                                tmp_UserID = island.candidate[j].userID;
                                tmp_UserIslandInfo = await getUserIslandInfo(tmp_UserID);
                                if (tmp_UserIslandInfo != -1 && tmp_UserIslandInfo) {
                                    await addIncome(tmp_UserID, island, -1, 6, candidateTiem, null, time);
                                }
                            }

                            if (tmp_UserIslandInfo.candidate) {
                                for (let k = 0; k < tmp_UserIslandInfo.candidate.length; k++) {
                                    if (tmp_UserIslandInfo.candidate[k] == islandID) {
                                        tmp_UserIslandInfo.candidate.splice(k, 1);
                                        await setCurrentCandidate(tmp_UserID, tmp_UserIslandInfo);
                                        break;
                                    }
                                }
                            }
                        }
                    }

                    island.candidate = [];
                    await setIslandCandidateInfo(island);
                }

                //结算占领
                if (island.plunderUserID != -1) {
                    if (island.plunderUserID == userID) {
                        tmp_UserID = island.plunderUserID;
                        tmp_UserIslandInfo = userIslandInfo;
                        await addIncome(tmp_UserID, island, -1, 0, date, tmp_UserIslandInfo);
                    } else {
                        tmp_UserID = island.plunderUserID;
                        tmp_UserIslandInfo = await getUserIslandInfo(tmp_UserID);
                        await addIncome(tmp_UserID, island, -1, 0, date);
                    }
                    if (tmp_UserIslandInfo != -1 && tmp_UserIslandInfo) {
                        for (let j = 0; j < tmp_UserIslandInfo.occupyed.length; j++) {
                            if (tmp_UserIslandInfo.occupyed[j] == islandID) {
                                tmp_UserIslandInfo.occupyed.splice(j, 1);
                                break;
                            }
                        }
                        await setCurrentOccupyed(tmp_UserID, tmp_UserIslandInfo);
                    }
                    await changeIslandInfo(islandID, -1, null, 0, -1, 0);
                }
            }
        }
    }
}

/**
 * 占领的岛屿被其他人占领时 或 占领时长结束 或 候补，添加收益
 * @param {Number} userID 
 * @param {Object} island 岛屿
 * @param {Number} occupyUserID 攻占者userID，-1达最长时间，-2主动撤离
 * @param {Number} type 0主动取消， 1占领时长结束，2占领的岛屿被其他人占领，3被候补顶替，4候补上位，5候补落选，6伪候补
 * @param {Number} __date 时间
 * @param {Object} __userIslandInfo 要添加收益的用户信息
 * @param {Number} __occupyTime 占领时间
 * @returns 
 */
let addIncome = async function (userID, island, occupyUserID, type, __date, __userIslandInfo, __occupyTime) {
    let userIslandInfo = __userIslandInfo;

    if (!userIslandInfo) {
        userIslandInfo = await getUserIslandInfo(userID);
    }

    let date = __date || Date.now();
    if (userIslandInfo != -1 && userIslandInfo) {
        let islandConfig = getIslandConfig(island.id);

        let time;
        if (__occupyTime) {
            time = __occupyTime;
        } else {
            time = date - parseInt(island.plunderTime);
        }

        if (time > islandConfig.maxPlunderTime * 60000) {
            time = islandConfig.maxPlunderTime;
        } else {
            time = parseInt(time / 60000);
        }

        if (time < 0) {
            time = 0;
        }

        let loss = 0;

        let obj = {
            islandID: island.id,//岛屿id
            occupyTime: time,//占领了多久
            userID: occupyUserID,
            date: date,
        }

        if (type == 2) {
            //2占领的岛屿被其他人占领,损失三分之一的物资
            loss = parseInt(time * 1 / 3);
            obj.loss = loss;
            obj.occupyTime = parseInt(time * 2 / 3);
        } else if (type == 3) {
            loss = parseInt(time * 1 / 3);
            obj.loss = loss;
            obj.occupyTime = parseInt(time * 2 / 3);
            obj.candidate = 1;
        } else if (type == 4) {
            obj.candidate = 2;
        } else if (type == 5) {
            obj.candidate = 3;
        } else if (type == 6) {
            obj.candidate = 4;
        }

        if (!userIslandInfo.income) {
            userIslandInfo.income = [];
        }
        userIslandInfo.income.push(obj);

        if (!__userIslandInfo) {
            await (new Promise(function (resolve, reject) {
                redisClient.hset('userIslandInfo:' + userID, 'income', JSON.stringify(userIslandInfo.income), function (err, obj) {
                    if (err != null) {
                        logger.error(err);
                        reject(false);
                    } else {
                        resolve(true);
                    }
                });
            }));
        }

        return loss;
    } else {
        return 0;
    }
}

/**
 * 占领的岛屿被其他玩家攻打之后添加战绩
 * @param {Number} userID 
 * @param {Object} island 岛屿对象
 * @param {Number} occupyUserID 来攻占的userID
 * @param {Number} result 攻占结果1成功，2失败，3被候补顶替
 * @param {Object} __userIslandInfo 要添加战绩的用户信息
 * @returns 
 */
let addRecord = async function (userID, island, occupyUserID, result, __dateTime, __userIslandInfo, __candidate) {

    let userIslandInfo = __userIslandInfo;

    if (!userIslandInfo) {
        userIslandInfo = await getUserIslandInfo(userID);
    }

    let date = __dateTime || Date.now();

    if (userIslandInfo != -1 && userIslandInfo) {
        if (!userIslandInfo.record) {
            userIslandInfo.record = [];
        }

        for (let index = 0; index < userIslandInfo.record.length; index++) {
            if (userIslandInfo.record[index].islandID == island.id && userIslandInfo.record[index].userID == occupyUserID && userIslandInfo.record[index].result == result) {
                //同一个人攻打一个岛屿多次失败只记录一次
                return;
            }
        }

        if (result == 1) {
            //被别人抢占时，删除该岛屿战绩
            for (let index = 0; index < userIslandInfo.record.length; index++) {
                if (userIslandInfo.record[index].islandID == island.id) {
                    userIslandInfo.record.splice(index, 1);
                    index--;
                }
            }
        }

        if (userIslandInfo.record.length >= 20) {
            for (let index = 0; index < userIslandInfo.record.length; index++) {
                if (userIslandInfo.record[index].result == 2) {
                    //删除一个别人攻打失败的记录
                    userIslandInfo.record.splice(index, 1);
                    break;
                }
            }
        }

        let obj = {
            islandID: island.id,//岛屿id
            userID: occupyUserID,//攻打者
            result: result,//结果，1攻打成功，2攻打失败
            date: date,
        };

        if (__candidate) {
            obj.candidate = 1;
        }

        userIslandInfo.record.push(obj);

        if (!__userIslandInfo) {
            await (new Promise(function (resolve, reject) {
                redisClient.hset('userIslandInfo:' + userID, 'record', JSON.stringify(userIslandInfo.record), function (err, obj) {
                    if (err != null) {
                        logger.error(err);
                        reject(false);
                    } else {
                        resolve(true);
                    }
                });
            }));
        }
    }
}

/**
 * 修改玩家占领的岛屿
 */
let setCurrentOccupyed = async function (userID, userIslandInfo) {
    if (!userID) {
        return;
    }
    if (!userIslandInfo.occupyed) {
        userIslandInfo.occupyed = [];
    }
    await (new Promise(function (resolve, reject) {
        redisClient.hset('userIslandInfo:' + userID, 'occupyed', JSON.stringify(userIslandInfo.occupyed), function (err, obj) {
            if (err != null) {
                logger.error(err);
                reject(false);
            } else {
                resolve(true);
            }
        });
    }));
}

/**
 * 修改玩家候补
 * @param {*} userID 
 * @param {*} userIslandInfo 
 */
let setCurrentCandidate = async function (userID, userIslandInfo) {
    if (!userID) {
        return;
    }
    if (!userIslandInfo.candidate) {
        userIslandInfo.candidate = [];
    }
    await (new Promise(function (resolve, reject) {
        redisClient.hset('userIslandInfo:' + userID, 'candidate', JSON.stringify(userIslandInfo.candidate), function (err, obj) {
            if (err != null) {
                logger.error(err);
                reject(false);
            } else {
                resolve(true);
            }
        });
    }));
}

/**
 * 同时占领上限
 */
let getOccupyLimit = function (userIslandInfo) {
    let result = islandsPlunder.occupyOnceMax;
    if (userIslandInfo.payOccupyTimes) {
        result += userIslandInfo.payOccupyTimes;
    }
    if (userIslandInfo.isVIP && userIslandInfo.isVIP == 1) {
        result += islandsPlunder.VIPIncrease;
    }
    if (result > islandsPlunder.occupyLimit) {
        result = islandsPlunder.occupyLimit;
    }
    return result;
}

/**
 * 获取岛屿信息
 */
let getIsland = async function (islandsID) {
    let island = await (new Promise(function (resolve, reject) {
        let dbkey = 'island:' + islandsID;
        redisClient.hgetall(dbkey, function (err, obj) {
            if (err != null) {
                logger.error(err);
                reject(-1);
            } else {
                if (obj == null) {
                    resolve(null);
                } else {
                    resolve(obj);
                }
            }
        });
    }));

    if (island != -1 && island) {
        island.plunderTime = parseInt(island.plunderTime);
        island.occupyStartTime = parseInt(island.occupyStartTime);
        if (island.battleFormation && typeof island.battleFormation == 'string') {
            island.battleFormation = JSON.parse(island.battleFormation);
        }
        // if (island.candidate && typeof island.candidate == 'string') {
        //     island.candidate = JSON.parse(island.candidate);
        //     for (let index = 0; index < island.candidate.length; index++) {
        //         if (island.candidate[index].battleFormation && typeof island.candidate[index].battleFormation == 'string') {
        //             island.candidate[index].battleFormation = JSON.parse(island.candidate[index].battleFormation);
        //         }
        //     }
        // }
        if (island.battleFormation && island.battleFormation.combat) {
            island.combat = island.battleFormation.combat;
        } else {
            island.combat = -1;
        }
        if (island.plunderUserID != -1) {
            island.plunderNickname = await matchService.getNickNameByUserID(island.plunderUserID);
        }
    }
    return island;
}

/**
 * 获取用户海岛掠夺信息
 */
let getUserIslandInfo = async function (userID) {
    let userDBkey = 'userIslandInfo:' + userID;
    let userIslandInfo = await (new Promise(function (resolve, reject) {
        redisClient.hgetall(userDBkey, function (err, obj) {
            if (err != null) {
                logger.error(err);
                reject(-1);
            } else {
                if (obj != null) {
                    resolve(obj);
                } else {
                    resolve(null);
                }
            }
        });
    }));

    if (userIslandInfo != -1 && userIslandInfo) {
        userIslandInfo.updateTime = parseInt(userIslandInfo.updateTime);
        userIslandInfo.dayResidueTimes = parseInt(userIslandInfo.dayResidueTimes);
        userIslandInfo.dayAddTimes = parseInt(userIslandInfo.dayAddTimes);
        if (userIslandInfo.payOccupyTimes && utils.isNumber(userIslandInfo.payOccupyTimes)) {
            userIslandInfo.payOccupyTimes = parseInt(userIslandInfo.payOccupyTimes);
        } else {
            userIslandInfo.payOccupyTimes = 0;
        }
        if (userIslandInfo.income && typeof userIslandInfo.income == 'string') {
            userIslandInfo.income = JSON.parse(userIslandInfo.income);
        }
        if (userIslandInfo.record && typeof userIslandInfo.record == 'string') {
            userIslandInfo.record = JSON.parse(userIslandInfo.record);
        }
        if (userIslandInfo.occupyed && typeof userIslandInfo.occupyed == 'string') {
            userIslandInfo.occupyed = JSON.parse(userIslandInfo.occupyed);
        }
        if (userIslandInfo.candidate && typeof userIslandInfo.candidate == 'string') {
            userIslandInfo.candidate = JSON.parse(userIslandInfo.candidate);
        }
        if (userIslandInfo.occupyed) {
            for (let index = 0; index < userIslandInfo.occupyed.length; index++) {
                userIslandInfo.occupyed[index] = parseInt(userIslandInfo.occupyed[index]);
            }
        }
        if (userIslandInfo.week) {
            userIslandInfo.week = parseInt(userIslandInfo.week);
        }
        if (userIslandInfo.score) {
            userIslandInfo.score = parseInt(userIslandInfo.score);
        }
    }

    return userIslandInfo;
}

/**
 * 修改redis岛屿信息
 * @param {*} islandID 岛屿id
 * @param {*} plunderUserID 掠夺者userID,-1无掠夺者
 * @param {*} battleFormation 守护的阵型
 * @param {*} plunderTime 什么时候掠夺的
 * @param {*} occupyingUserID 攻打中，-1没人
 * @param {*} occupyStartTime 什么时候开始攻打的
 * @returns void
 */
let changeIslandInfo = async function (islandID, plunderUserID, battleFormation, plunderTime, occupyingUserID, occupyStartTime) {
    if (!islandID || !plunderUserID) {
        console.error('参数指定错误');
        return;
    }

    if (battleFormation && typeof battleFormation == 'object') {
        battleFormation = JSON.stringify(battleFormation);
    } else if (!battleFormation) {
        battleFormation = '';
    }
    if (!plunderTime) {
        plunderTime = 0;
    }
    if (!occupyingUserID) {
        occupyingUserID = -1;
    }
    if (!occupyStartTime) {
        occupyStartTime = 0;
    }

    await (new Promise(function (resolve, reject) {
        redisClient.hset('island:' + islandID, 'plunderUserID', plunderUserID, 'battleFormation', battleFormation, 'plunderTime', plunderTime, 'occupyingUserID', occupyingUserID, 'occupyStartTime', occupyStartTime, function (err, obj) {
            if (err != null) {
                logger.error(err);
                reject(false);
            } else {
                resolve(true);
            }
        });
    }));
}

/**
 * 修改岛屿候补信息
 * @param {*} island 
 */
let setIslandCandidateInfo = async function (island) {
    if (!island.candidate) {
        island.candidate = [];
    }
    // await (new Promise(function (resolve, reject) {
    //     redisClient.hset('island:' + island.id, 'candidate', JSON.stringify(island.candidate), function (err, obj) {
    //         if (err != null) {
    //             logger.error(err);
    //             reject(false);
    //         } else {
    //             resolve(true);
    //         }
    //     });
    // }));

    await (new Promise(function (resolve, reject) {
        redisClient.set('islandCandidate:' + island.id, JSON.stringify(island.candidate), function (err, obj) {
            if (err != null) {
                logger.error(err);
                reject(false);
            } else {
                resolve(true);
            }
        });
    }));
}

/**
 * 获取候补信息
 * @param {*} island 
 */
let getIslandCandidateInfo = async function (island) {
    if (!island.candidate) {
        let candidate = await (new Promise(function (resolve, reject) {
            redisClient.get('islandCandidate:' + island.id, function (err, obj) {
                if (err != null) {
                    logger.error(err);
                    reject(-1);
                } else {
                    resolve(obj);
                }
            });
        }));

        if (candidate != -1) {
            if (candidate) {
                if (typeof candidate == 'string') {
                    candidate = JSON.parse(candidate);
                }
                for (let index = 0; index < candidate.length; index++) {
                    if (candidate[index].battleFormation && typeof candidate[index].battleFormation == 'string') {
                        candidate[index].battleFormation = JSON.parse(candidate[index].battleFormation);
                    }
                }
                island.candidate = candidate;
            } else {
                island.candidate = [];
            }
        }
    }
}

/**
 * 获取主候补席
 * @param {*} island 
 * @returns 
 */
let getMainCandidate = async function (island) {
    if (island && island.candidate && island.candidate.length > 0) {
        candidateSort(island);
        let tmp_UserIslandInfo;
        for (let index = 0; index < island.candidate.length; index++) {
            if (island.candidate[index].result == 1) {
                return island.candidate[index];

                // tmp_UserIslandInfo = await getUserIslandInfo(island.candidate[index].userID);
                // if (tmp_UserIslandInfo != -1 && tmp_UserIslandInfo) {
                //     if (tmp_UserIslandInfo.occupyed && tmp_UserIslandInfo.occupyed < getOccupyLimit(tmp_UserIslandInfo) && tmp_UserIslandInfo.dayResidueTimes > 0) {
                //         return island.candidate[index];
                //     }
                // }
            }
        }
    }
    return null;
}

/**
 * 候补排序
 * @param {*} island 
 */
let candidateSort = function (island) {
    if (island && island.candidate && island.candidate.length > 0) {
        let array = island.candidate;
        for (let i = 0; i < array.length; i++) {
            let tmp = i;
            for (let j = i + 1; j < array.length; j++) {
                if (array[tmp].result == 1) {
                    if ((array[j].result == 1 && parseInt(array[j].round) < parseInt(array[tmp].round))
                        || (array[j].result == 1 && parseInt(array[j].round) == parseInt(array[tmp].round) && parseInt(array[j].hpPercent) < parseInt(array[tmp].hpPercent))) {
                        tmp = j;
                    }
                } else {
                    if (array[j].result == 1
                        || (array[j].result == 2 && parseInt(array[j].round) > parseInt(array[tmp].round))
                        || (array[j].result == 2 && parseInt(array[j].round) == parseInt(array[tmp].round) && parseInt(array[j].hpPercent) > parseInt(array[tmp].hpPercent))) {
                        tmp = j;
                    }
                }
            }
            if (tmp != i) {
                let t = array[tmp];
                array[tmp] = array[i];
                array[i] = t;
            }
        }
    }
}

/**
 * 获取岛屿配置 
 */
let getIslandConfig = function (islandID) {
    islandID = islandID % 1000;
    let islandConfig = null;
    for (let index = 0; index < islandsPlunder.islands.length; index++) {
        if (islandsPlunder.islands[index].id == islandID) {
            islandConfig = islandsPlunder.islands[index];
            break;
        }
    }
    return islandConfig;
}

let getStandardIslandData = function (island) {
    return {
        id: island.id,
        plunderUserID: island.plunderUserID,
        plunderTime: island.plunderTime,
        occupyingUserID: island.occupyingUserID,
        occupyStartTime: island.occupyStartTime,
        plunderNickname: island.plunderNickname,
    }
}

let getHeadInfo = async function (userID) {
    let result = {
        head: 10,
        headRing: 0,
    }
    await (new Promise(function (resolve, reject) {
        redisClient.hget('userinfo:' + userID, 'head', function (err, obj) {
            if (err != null) {
                logger.error(err);
                reject(false);
            } else {
                if (obj) {
                    result = JSON.parse(obj);
                }
                resolve(true);
            }
        });
    }));
    return result;
}

/**
 * 每日挑战次数
 */
let getUserDayChallengeTimes = async function (userID) {
    let result = islandsPlunder.dayResidueTimes;

    let monthCardInfo;
    await (new Promise(function (resolve, reject) {
        redisClient.hgetall('monthCard:' + userID, function (err, obj) {
            if (err != null) {
                logger.error(err);
                reject(false);
            } else {
                if (obj) {
                    monthCardInfo = obj;
                }
                resolve(true);
            }
        });
    }));

    if (monthCardInfo) {
        let date = Date.now();
        for (const key in monthCardInfo) {
            if (monthCardInfo.hasOwnProperty(key)) {
                let monthCard = JSON.parse(monthCardInfo[key]);

                let buyTime = new Date(monthCard.buyTime);
                let expirationTime = new Date();//过期时间
                expirationTime.setDate(buyTime.getDate() + 30);
                expirationTime.setHours(23, 59, 59, 999);

                if (date < expirationTime) {
                    //未过期
                    result += islandsPlunder.monthCardIncrease;
                }
            }
        }
    }

    return result;
}

/**
 * 时间戳，天数
 * @param {Number} date 
 * @returns 
 */
let getCurrentDay = function (date) {
    date += 8 * 3600 * 1000;
    let currentDay = parseInt(date / 86400000);//当前天数（时间戳）， 86400000 = 1000 * 60 *60 *24 一天
    return currentDay;
}

/**
 * 时间戳，星期
 */
let getNowTimeStampWeeks = function (date) {
    date = date / 1000 + 8 * 3600;
    //let day = parseInt(date / 3600 / 24) - 4;//1970年开年第一周只有四天
    let day = parseInt(date / 3600 / 24) - 3;//星期天4点结算，少减1天
    return parseInt(1 + 1 + day / 7);
}

let getCurMatchInfo = async function () {
    return await (new Promise(function (resolve, reject) {
        let type = 105;
        let dbkey = 'curMatchInfo:' + type;
        redisClient.hgetall(dbkey, function (err, retObj) {
            if (err != null) {
                reject(null);
                logger.error(err);
            } else {
                if (retObj) {
                    retObj.startTime = new Date(Date.parse(retObj.startTime.replace(/-/g, "/")));
                    retObj.endTime = new Date(Date.parse(retObj.endTime.replace(/-/g, "/")));
                    resolve(retObj);
                } else {
                    reject(null);
                }
            }
        });
    }));
};

let getMatchStatus = function (matchItem) {
    let curTime = new Date();

    if (curTime < matchItem.startTime) {
        //未开始
        return 1;
    }

    let dateDiff = (matchItem.endTime - curTime) / (1000 * 60);

    if (dateDiff > 0 && dateDiff < islandsPlunder.bulletintime) {
        //公示期
        return 3;
    }

    if (dateDiff <= 0) {
        //已经结束
        return 4;
    }
    return 2;

}

/**
 * 排行榜上报
 */
let reportRankScore = async function (userID, score) {
    let userIslandInfo = await getUserIslandInfo(userID);

    if (userIslandInfo != -1 && userIslandInfo) {
        let date = Date.now();
        let nowWeek = getNowTimeStampWeeks(date);

        if (userIslandInfo.week) {
            if (userIslandInfo.week != nowWeek) {
                userIslandInfo.week = nowWeek;
                userIslandInfo.score = 0;
            }
            userIslandInfo.score += score;
        } else {
            userIslandInfo.week = nowWeek;
            userIslandInfo.score = score;
        }

        await updateRankScore(userID, userIslandInfo);

        await matchService.reportScore(userID, 105, userIslandInfo.score);

        return userIslandInfo.score;
    }
    return 0;
}

let updateRankScore = async function (userID, userIslandInfo) {
    await (new Promise(function (resolve, reject) {
        redisClient.hset('userIslandInfo:' + userID, 'week', userIslandInfo.week, 'score', userIslandInfo.score, function (err, obj) {
            if (err != null) {
                logger.error(err);
                reject(false);
            } else {
                resolve(true);
            }
        });
    }));
}
