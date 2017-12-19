// ==================================================================================================
//
// Dependencies: lodash
// simple bare-bones waypoint-esque
// next steps:
//  add trigger point to center of element
//  implement removeCheckpoint (perhaps by a name attribute or return the checkpoint itself at creation with its method to remove itself)
//  allow offset prop in checkpoint to be a function? or allow way to build custom offset dynamically
//  add a way for multiple instances collaborate to maintain only one scroll and resize event gets added while maintaining same api usage
// ==================================================================================================

import { throttle, debounce, forEach, reject } from 'lodash'

const DEFAULT_OPTIONS = {
  showLogs: false
}

const checkpoint = (options = DEFAULT_OPTIONS) => {
  const cbs = {}

  const props = {
    ...options,
    isEnabled: false,
    windowHeight: getWindowHeight(),
    bodyHeight: getBodyHeight(),
    scrollPoints: [],
    currentScroll: window.pageYOffset,
    doneEntering: false
  }

  const DEFAULT_CHECKPOINT_OPTIONS = {
    trigger: 'top',
    offset: 1,
    triggerOnce: false,
    handler(direction, element) {
      console.log('define handler. direction is', direction, element)
    }
  }

  const TRIGGER_METHODS_MAP = {
    top: offsetTopAtCustom,
    bottom: offsetBottomAtCustom,
    center: offsetCenterAtCustom
  }

  const init = () => {
    enable()
  }

  const onScroll = () => {
    if (!props.isEnabled) return
    props.currentScroll = window.pageYOffset
    checkScrollPoints()
  }

  const onResize = () => {
    if (!props.isEnabled) return
    props.currentScroll = window.pageYOffset
    props.windowHeight = getWindowHeight()
    props.bodyHeight = getBodyHeight()
    props.scrollPoints = recalcCheckpoints()
    checkScrollPoints()
  }

  const enable = () => {
    if (props.isEnabled) return

    cbs.onResize = debounce(onResize, 300, false)
    cbs.onScroll = throttle(onScroll, 300)

    window.addEventListener('resize', cbs.onResize)
    window.addEventListener('scroll', cbs.onScroll)

    props.isEnabled = true
  }

  const disable = () => {
    if (!props.isEnabled) return

    // Remove your event handlers here
    window.removeEventListener('resize', cbs.onResize)
    window.removeEventListener('scroll', cbs.onScroll)

    props.isEnabled = false
  }

  const destroy = () => {
    disable()
    // remove reference to key:values in 'global' objects
  }

  function getWindowHeight() { return window.innerHeight || document.documentElement.clientHeight }
  function getBodyHeight() {
    const {body, documentElement} = document

    return Math.max(body.scrollHeight, body.offsetHeight, documentElement.clientHeight,
        documentElement.scrollHeight, documentElement.offsetHeight)
  }

  const checkScrollPoints = function() {
    const { scrollPoints } = props

    scrollPoints.forEach(point => {
      if (props.currentScroll >= point.value && !point.hasPassed) {
        point.handler('up', point.element)
        point.hasPassed = true
        if (point.triggerOnce) removeCheckpoint(point)
      } else if (props.currentScroll <= point.value && point.hasPassed) {
        point.handler('down', point.element)
        point.hasPassed = false
      }
    })
  }

  const addCheckpoint = options => {
    if (!options.element) {
      throw new Error('`element key is missing from addCheckpoint options')
    }

    const fullOptions = {
      ...DEFAULT_CHECKPOINT_OPTIONS,
      ...options
    }

    if (!Object.keys(TRIGGER_METHODS_MAP).includes(fullOptions.trigger)) {
      console.error('trigger value in addCheckpoint options is invalid. defaulting to top')
      fullOptions.trigger = 'top'
    }

    props.currentScroll = window.pageYOffset

    if (options.element.length) {
      forEach(options.element, el => {
        pushScrollPoint(genCheckpoint(el, fullOptions))
      })
    } else {
      pushScrollPoint(genCheckpoint(fullOptions.element, fullOptions))
    }
  }

  const pushScrollPoint = newPoint => {
    // filter to remove nulls
    props.scrollPoints = [...props.scrollPoints, newPoint].filter(p => p)
  }

  const genCheckpoint = (element, options) => {
    const {top, height} = element.getBoundingClientRect()
    const method = TRIGGER_METHODS_MAP[options.trigger]
    const value = method(element, options.offset, top, height)
    const hasPassed = props.currentScroll >= value

    if (hasPassed) {
      options.handler('up', element)
      if (options.triggerOnce) return null
    }

    return {
      method,
      value,
      hasPassed,
      element: element,
      offset: options.offset,
      handler: options.handler,
      triggerOnce: options.triggerOnce
    }
  }

  const removeCheckpoint = ({element}) => {
    props.scrollPoints = reject(props.scrollPoints, p => p.element === element)
    if (props.scrollPoints.length <= 0 && props.doneEntering) {
      disable()
    }
  }

  const recalcCheckpoints = () => {
    return props.scrollPoints.map(point => {
      const {top, height} = point.element.getBoundingClientRect()
      return {
        ...point,
        value: point.method(point.element, point.offset, top, height)
      }
    })
  }

  // Utility Functions
  // _____________________________________________________________

  // Takes a string input representing a pixel value, e.g. '20px' or '-20px'
  // and coerces it into a number, integer or float
  const coercePxToNum = pixels => +pixels.match(/-?\d*[^px]/)[0]

  // Takes either a number from 0 through 1 that represents a percentage
  // or a string representing a pixel value, e.g. '20px' or '-20px'
  const convertOffset = offset => {
    return typeof offset === 'string' ? props.windowHeight - coercePxToNum(offset) : props.windowHeight * offset
  }

  // Makes sure the number is within the page bounds.
  // Returns outer number closest to input if it falls outside
  const numWithinPageBounds = num => Math.min(Math.max(0, num), props.bodyHeight)

  const checkFixedScroll = element => element.getAttribute('checkpoint-fixed') ? 0 : props.currentScroll

  // Functions for setting where element in window is triggered
  // _____________________________________________________________

  // Top of element is at the top of the page
  // const offsetTopAtTop = element => offsetTopAtCustom(element, 0)

  // Top of element is at the bottom of the page
  // const offsetTopAtBottom = element => offsetTopAtCustom(element, 1)

  // Bottom of element is at the top of the page
  // const offsetBottomAtTop = element => offsetBottomAtCustom(element, 0)

  // Bottom of element is at the bottom of the page
  // const offsetBottomAtBottom = element => offsetBottomAtCustom(element, 1)

  // Top of element is at custom point of page (Number between 0 and 1. 0 is at top, 1 is at bottom)
  function offsetTopAtCustom(element, offset, top) {
    return numWithinPageBounds(top - convertOffset(offset) + checkFixedScroll(element))
  }

  // Bottom of element is at custom point of page (Number between 0 and 1. 0 is at top, 1 is at bottom)
  function offsetBottomAtCustom(element, offset, top, height) {
    return numWithinPageBounds(top + height - convertOffset(offset) + checkFixedScroll(element))
  }

  function offsetCenterAtCustom(element, offset, top, height) {
    return numWithinPageBounds(top + (height / 2) - convertOffset(offset) + checkFixedScroll(element))
  }

  const clog = (...args) => {
    if (props.showLogs) console.log(...args)
  }

  const doneEntering = () => {
    props.doneEntering = true
  }

  return {
    init,
    enable,
    disable,
    destroy,
    addCheckpoint,
    removeCheckpoint,
    doneEntering
  }
}

export default checkpoint
