import { htmlElementAsString, getTimestamp } from '@smart-track/utils';
import { EVENT_TYPES, STATUS_CODE } from '@smart-track/common';
import { ErrorTarget, RouteHistory, HttpData } from '@smart-track/types';
import { HandleEvents } from './handleEvents';
import { breadcrumb } from './index';
import { addReplaceHandler } from './replace';

export function setupReplace(): void {
  // 白屏检测
  addReplaceHandler({
    callback: () => {
      HandleEvents.handleWhiteScreen();
    },
    type: EVENT_TYPES.WHITE_SCREEN,
  });
  // 重写XMLHttpRequest
  addReplaceHandler({
    callback: (data: HttpData) => {
      HandleEvents.handleHttp(data, EVENT_TYPES.XHR);
    },
    type: EVENT_TYPES.XHR,
  });
  // 重写fetch
  addReplaceHandler({
    callback: (data: HttpData) => {
      HandleEvents.handleHttp(data, EVENT_TYPES.FETCH);
    },
    type: EVENT_TYPES.FETCH,
  });
  // 捕获错误
  addReplaceHandler({
    callback: (error: ErrorTarget) => {
      HandleEvents.handleError(error);
    },
    type: EVENT_TYPES.ERROR,
  });
  // 监听history模式路由的变化
  addReplaceHandler({
    callback: (data: RouteHistory) => {
      HandleEvents.handleHistory(data);
    },
    type: EVENT_TYPES.HISTORY,
  });
  // 添加handleUnhandledRejection事件
  addReplaceHandler({
    callback: (data: any) => {
      HandleEvents.handleUnhandledRejection(data);
    },
    type: EVENT_TYPES.UNHANDLEDREJECTION,
  });
  // 监听click事件
  addReplaceHandler({
    callback: (data: any) => {
      // 获取html信息
      const htmlString = htmlElementAsString(data.data.activeElement as HTMLElement);
      if (htmlString) {
        breadcrumb.push({
          type: EVENT_TYPES.CLICK,
          status: STATUS_CODE.OK,
          category: breadcrumb.getCategory(EVENT_TYPES.CLICK),
          data: htmlString,
          time: getTimestamp(),
        });
      }
    },
    type: EVENT_TYPES.CLICK,
  });
  // 监听hashchange
  addReplaceHandler({
    callback: (e: HashChangeEvent) => {
      HandleEvents.handleHashchange(e);
    },
    type: EVENT_TYPES.HASHCHANGE,
  });
}
