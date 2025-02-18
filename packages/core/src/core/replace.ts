import {
  _global,
  on,
  getTimestamp,
  replaceAop,
  throttle,
  getLocationHref,
  isExistProperty,
  variableTypeDetection,
  supportsHistory,
} from '@smart-track/utils';
import { EVENT_TYPES, HTTP_TYPE, EMethods } from '@smart-track/common';
import { ReplaceHandler, voidFun } from '@smart-track/types';
import { transportData, options, notify, subscribeEvent } from './index';

// 判断当前接口是否为需要过滤掉的接口
function isFilterHttpUrl(url: string): boolean {
  return options.filterXhrUrlRegExp && options.filterXhrUrlRegExp.test(url);
}
function replace(type: EVENT_TYPES): void {
  switch (type) {
    case EVENT_TYPES.WHITE_SCREEN:
      whiteScreen();
      break;
    case EVENT_TYPES.XHR:
      xhrReplace();
      break;
    case EVENT_TYPES.FETCH:
      fetchReplace();
      break;
    case EVENT_TYPES.ERROR:
      listenError();
      break;
    case EVENT_TYPES.HISTORY:
      historyReplace();
      break;
    case EVENT_TYPES.UNHANDLEDREJECTION:
      unhandledrejectionReplace();
      break;
    case EVENT_TYPES.CLICK:
      domReplace();
      break;
    case EVENT_TYPES.HASHCHANGE:
      listenHashchange();
      break;
    default:
      break;
  }
}
export function addReplaceHandler(handler: ReplaceHandler): void {
  if (!subscribeEvent(handler)) return;
  replace(handler.type);
}
function xhrReplace(): void {
  if (!('XMLHttpRequest' in _global)) {
    return;
  }
  const originalXhrProto = XMLHttpRequest.prototype;
  replaceAop(
    originalXhrProto,
    'open',
    (originalOpen: voidFun) =>
      function (this: any, ...args: any[]): void {
        this.smartTrackXhr = {
          method: variableTypeDetection.isString(args[0]) ? args[0].toUpperCase() : args[0],
          url: args[1],
          sTime: getTimestamp(),
          type: HTTP_TYPE.XHR,
        };
        originalOpen.apply(this, args);
      }
  );
  replaceAop(
    originalXhrProto,
    'send',
    (originalSend: voidFun) =>
      function (this: any, ...args: any[]): void {
        const { method, url } = this.smartTrackXhr;
        // 监听loadend事件，接口成功或失败都会执行
        on(this, 'loadend', function (this: any) {
          // isSdkTransportUrl 判断当前接口是否为上报的接口
          // isFilterHttpUrl 判断当前接口是否为需要过滤掉的接口
          if (
            (method === EMethods.Post && transportData.isSdkTransportUrl(url)) ||
            isFilterHttpUrl(url)
          ) {
            return;
          }
          const { responseType, response, status } = this;
          this.smartTrackXhr.requestData = args[0];
          const eTime = getTimestamp();
          // 设置该接口的time，用户用户行为按时间排序
          this.smartTrackXhr.time = this.smartTrackXhr.sTime;
          this.smartTrackXhr.Status = status;
          if (['', 'json', 'text'].indexOf(responseType) !== -1) {
            // 用户设置handleHttpStatus函数来判断接口是否正确，只有接口报错时才保留response
            if (options.handleHttpStatus && typeof options.handleHttpStatus === 'function') {
              this.smartTrackXhr.response = response && JSON.parse(response);
            }
          }
          // 接口的执行时长
          this.smartTrackXhr.elapsedTime = eTime - this.smartTrackXhr.sTime;
          // 执行之前注册的xhr回调函数
          notify(EVENT_TYPES.XHR, this.smartTrackXhr);
        });
        originalSend.apply(this, args);
      }
  );
}
function fetchReplace(): void {
  if (!('fetch' in _global)) {
    return;
  }
  replaceAop(
    _global,
    EVENT_TYPES.FETCH,
    originalFetch =>
      function (url: any, config: Partial<Request> = {}): void {
        const sTime = getTimestamp();
        const method = (config && config.method) || 'GET';
        let fetchData = {
          type: HTTP_TYPE.FETCH,
          method,
          requestData: config && config.body,
          url,
          response: '',
        } as {
          [key: string]: any;
        };
        // 获取配置的headers
        const headers = new Headers(config.headers || {});
        Object.assign(headers, {
          setRequestHeader: headers.set,
        });
        config = { ...config, ...headers };
        return originalFetch.apply(_global, [url, config]).then(
          (res: any) => {
            // 克隆一份，防止被标记已消费
            const tempRes = res.clone();
            const eTime = getTimestamp();
            fetchData = {
              ...fetchData,
              elapsedTime: eTime - sTime,
              Status: tempRes.status,
              time: sTime,
            };
            tempRes.text().then((data: any) => {
              // 同理，进接口进行过滤
              if (
                (method === EMethods.Post && transportData.isSdkTransportUrl(url)) ||
                isFilterHttpUrl(url)
              ) {
                return;
              }
              // 用户设置handleHttpStatus函数来判断接口是否正确，只有接口报错时才保留response
              if (options.handleHttpStatus && typeof options.handleHttpStatus === 'function') {
                fetchData.response = data;
              }
              notify(EVENT_TYPES.FETCH, fetchData);
            });
            return res;
          },
          // 接口报错
          (err: any) => {
            const eTime = getTimestamp();
            if (
              (method === EMethods.Post && transportData.isSdkTransportUrl(url)) ||
              isFilterHttpUrl(url)
            ) {
              return;
            }
            fetchData = { ...fetchData, elapsedTime: eTime - sTime, status: 0, time: sTime };
            notify(EVENT_TYPES.FETCH, fetchData);
            throw err;
          }
        );
      }
  );
}
function listenHashchange(): void {
  // 通过onpopstate事件，来监听hash模式下路由的变化
  if (isExistProperty(_global, 'onhashchange')) {
    on(_global, EVENT_TYPES.HASHCHANGE, (e: HashChangeEvent) => {
      notify(EVENT_TYPES.HASHCHANGE, e);
    });
  }
}

function listenError(): void {
  on(
    _global,
    'error',
    (e: ErrorEvent) => {
      notify(EVENT_TYPES.ERROR, e);
    },
    true
  );
}

// last time route
let lastHref: string = getLocationHref();
function historyReplace(): void {
  // 是否支持history
  if (!supportsHistory()) return;
  const oldOnpopstate = _global.onpopstate;
  // 添加 onpopstate事件
  _global.onpopstate = function (this: any, ...args: any): void {
    const to = getLocationHref();
    const from = lastHref;
    lastHref = to;
    notify(EVENT_TYPES.HISTORY, {
      from,
      to,
    });
    oldOnpopstate && oldOnpopstate.apply(this, args);
  };
  function historyReplaceFn(originalHistoryFn: voidFun): voidFun {
    return function (this: any, ...args: any[]): void {
      const url = args.length > 2 ? args[2] : undefined;
      if (url) {
        const from = lastHref;
        const to = String(url);
        lastHref = to;
        notify(EVENT_TYPES.HISTORY, {
          from,
          to,
        });
      }
      return originalHistoryFn.apply(this, args);
    };
  }
  // 重写pushState、replaceState事件
  replaceAop(_global.history, 'pushState', historyReplaceFn);
  replaceAop(_global.history, 'replaceState', historyReplaceFn);
}
function unhandledrejectionReplace(): void {
  on(_global, EVENT_TYPES.UNHANDLEDREJECTION, (ev: PromiseRejectionEvent) => {
    // ev.preventDefault() 阻止默认行为后，控制台就不会再报红色错误
    notify(EVENT_TYPES.UNHANDLEDREJECTION, ev);
  });
}
function domReplace(): void {
  if (!('document' in _global)) return;
  // 节流，默认0s
  const clickThrottle = throttle(notify, options.throttleDelayTime);
  on(
    _global.document,
    'click',
    function (this: any): void {
      clickThrottle(EVENT_TYPES.CLICK, {
        category: 'click',
        data: this,
      });
    },
    true
  );
}
function whiteScreen(): void {
  notify(EVENT_TYPES.WHITE_SCREEN);
}
