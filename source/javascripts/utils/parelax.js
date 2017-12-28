import {forEach, map, reduce, omit, throttle, debounce, chunk, inRange} from 'lodash'
import {scaleLinear} from 'd3-scale'
import {getWindowHeight} from '.'

// todos:
//  add ability to animate things on a quadratic curve (ie animate opacity in and out)

// down the line:
//  figure out base stylesheet (if any)
//
//  write tests
//
//  how to calculate rotation in matrix (or at least combine all rotations into one)
//
//  do parallax elements require absolute positioning? regardless, how to handle parallax
//  inside another parallax so that they can animate independently (necessitating absolute
//  positioning). maybe dom structure is the better answer (where possible). also, if
//  absolute position, then instruct the parent element to take the height of parallaxed
//  element to counter collapse
//
//  sometimes scroll events are delayed. perhaps consider running a continuous loop with RAF/setTimeout
//  and debounce scroll with leading set to true to toggle an `isScrolling` value to allow updates
//  to be made (or to initiate/kill RAF)
//
//  going to compensate for nested parallax elements?
//
//  add support for callbacks at trigger points? such as add `position:fixed;`. functionality
//  is handled in checkpoint, although that currently doesnt work with parallax as it only
//  caches values at the fore. pass an optional `isParallax` flag to checkpoint to continuous
//  measurements?

const parelax = (prefix = 'parelax') => {
  const props = {
    prefix,
    isEnabled: false,
    elData: [
      // {
      //   element: DOM,
      //   dimensions: {
      //     top: 1 // real top value with only preexisting transforms
      //     height: 1,
      //     width: 1
      //   }
      //   transforms: {
      //     initial: '',
      //     translateX: {
      //       value: 'from,100,to,-100' || '100' (for equal spread in both directions),
      //       spread: 'top,1,center,0.5',
      //       domain: [400, 600], scroll start and end values
      //       scales: [scaleLinear().domain().range().clamp(true)]
      //     }
      //   },
      //   styles: {} same structure as transforms but without `initial`
      // }
    ],
    currentScroll: window.pageYOffset,
    viewportHeight: getWindowHeight(),
    isMobileDevice: 'ontouchstart' in window,
    inviewBuffer: 30
  }

  const cbs = {}

  /**
   * Complete list of animatable properties. transform, css, and all each have a `normal` key,
   * which is the raw CSS property name, and they each have a `prefixed` key which prefixes they
   * CSS property with 'parelax` or otherwise defined prefix
   *
   * @type {Object}
   */
  const attrs = {
    transform: {
      normal: ['translateY', 'translateX', 'scaleX', 'skewY', 'skewX', 'scaleY', 'rotate', 'rotate3d', 'rotateX', 'rotateY', 'rotateZ']
    },
    css: {
      normal: ['width', 'height', 'padding', 'margin', 'fontSize', 'zIndex', 'opacity', 'top', 'right', 'bottom', 'left']
    },
    all: {}
  }
  attrs.all.normal = [...attrs.transform, ...attrs.css]
  attrs.transform.prefixed = attrs.transform.normal.map(parelaxPrefix)
  attrs.css.prefixed = attrs.css.normal.map(parelaxPrefix)
  attrs.all.prefixed = attrs.all.normal.map(parelaxPrefix)

  let els = []

  function parelaxPrefix(str) {
    return `${props.prefix}-${str}`
  }

  /**
   * Given the transforms object created from `setupData`, combines the values based on the
   * current scroll into a normal matrix (not matrix3d (yet (maybe))) as well as any rotation
   * values appended after the matrix (because i dont know how to calculate rotation into a matrix
   * (and matrix3d))
   *
   * @param  {Object} elData  All data for the element
   * @return {String}         Matrix and rotation style to be applied inline
   */
  const generateTransform = elData => {
    const {dimensions: {width, height}} = elData
    const {currentScroll} = props
    const [initialScaleX, initialSkewY, initialSkewX, initialScaleY, initialX, initialY] = elData.transforms.initial
    const {scaleX, skewY, skewX, scaleY, translateX, translateY, rotate, rotateX, rotateY, rotate3d} = elData.transforms

    // TODO: refactor?
    const scX = !scaleX ? initialScaleX : scaleX.scales[0](currentScroll)
    const skY = !skewY ? initialSkewY : skewY.scales[0](currentScroll)
    const skX = !skewX ? initialSkewX : skewX.scales[0](currentScroll)
    const scY = !scaleY ? initialScaleY : scaleY.scales[0](currentScroll)
    const tX = !translateX ? initialX : calcTransform(translateX.scales[0](currentScroll), width, translateX.value.from[0])
    const tY = !translateY ? initialY : calcTransform(translateY.scales[0](currentScroll), height, translateY.value.from[0])

    const r = rotateVal('rotate', rotate)
    const rX = rotateVal('rotateX', rotateX)
    const rY = rotateVal('rotateY', rotateY)
    const r3d = rotateVal('rotate3d', rotate3d)

    return `${matrix([scX, skY, skX, scY, tX, tY])} ${r} ${rX} ${rY} ${r3d}`.trim()
  }

  const calcTransform = (scaledTransform, size, fromVal) => {
    return fromVal.includes('%') ? (scaledTransform / 100) * size : scaledTransform
  }

  /**
   * Given a rotate property name, checks if the given data to calculate value based on scroll position
   * exists, otherwise returns the corresponding inline rotate value for inline style use
   *
   * @param  {String} name       CSS property name for any rotate
   * @param  {Object} rotateData Data object created by `setupData` for an element
   * @return {String}            Inline CSS value for rotation
   */
  const rotateVal = (name, rotateData) => {
    return !rotateData ? '' : `${name}(${rotateData.scales[0](props.currentScroll)}deg)`
  }

  /**
   * Similar to `generateTransform`, combines and returns all the styles for an element
   * based on the current scroll and each styles scales to be applied inline to that element
   *
   * @param  {Object} styles Set of styles
   * @return {String}        Inline string of styles
   */
  const generateStyle = styles => {
    const {currentScroll} = props

    return Object.keys(styles).reduce((a, k, i) => {
      return `${a}${k}:${styles[k].scales.map(s => setStyleDisplay(s(currentScroll), k, styles[k].value.from[0])).join(' ')};`
    }, '')
  }

  /**
   * Joins and wraps array values with matrix string for inline styles
   *
   * @param  {Array}  array Regular matrix values
   * @return {String}       Inline matrix style
   */
  const matrix = (array = [1, 0, 0, 1, 0, 0]) => `matrix(${array.join(',')})`

  /**
   * Takes a matrix string and returns the number values at each position
   * Note: values are in px
   *
   * @param  {String} matrix Matrix string, as retrieved from `getComputedStyle`
   * @return {Array}         Each value in the matrix passed through parseFloat
   */
  const parseMatrix = matrix => {
    return matrix.length === 0 ? [1, 0, 0, 1, 0, 0] : matrix.substring(7, matrix.length - 1).split(',').map(parseFloat)
  }

  /**
   * Returns top and height of an element. Top takes into account the current
   * scroll value.
   *
   * @param  {DOM Node} element Node to get top/height values
   * @return {Object}           Resulting top/height/width values
   */
  const getDimensions = (element) => {
    const {top, height, width} = element.getBoundingClientRect()
    const realTop = top + props.currentScroll
    return {
      height,
      width,
      top: realTop
    }
  }

  /**
   * Determines if and returns any transforms applied to the element through CSS
   * Returns 'none' if no transform styles are present
   *
   * @param  {DOM Node} element   Node to read transform styles from
   * @return {String}             Computed transform style or 'none'
   */
  const getInitialTransform = element => {
    const computedTransform = window.getComputedStyle(element).transform
    return computedTransform === 'none' ? '' : computedTransform
  }

  /**
   * Takes the CSS atttribute and the value as defined in the DOM, parses
   * it to an object filling in any defaults not defined. Spread denotes which
   * parts of the element and where in the viewport to enact changes. Value
   * contains the from and to numbers to animate between and gets mapped to
   * the scale domain
   *
   * @param  {String} attr          Base CSS attribute
   * @param  {String} attrValue     Value of the attribute
   * @return {Object}               Returns value and spread data
   */
  const structureElData = (attr, attrValue) => {
    // const attrValue = "value=100;spread=top,0.75,bottom,0.25"
    const split = attrValue.split(';').map(s => s.split('='))
    const value = split.find(s => s[0] === 'value')[1]
    const spread = split.find(s => s[0] === 'spread')

    const result = {
      // default spread
      spread: {
        start: ['top', 1],
        finish: ['bottom', 0]
      },
      value: value.includes(',')
        ? chunk(value.split(','), 2).reduce((a, [k ,v]) => ({
          ...a,
          [k]: attrParser(attr, v)
        }), {})
        // default value
        : {
          from: [adjustAttrValue(value).divide(2)],
          to: [adjustAttrValue(value).divide(-2)]
        }
    }

    if (spread) {
      const [start, finish] = chunk(spread[1].split(','), 2).map(set => {
        return [set[0], +set[1]]
      }).sort((a, b) =>  b[1] - a[1])

      result.spread = {start, finish}
    }

    return result
  }

  /**
   * Generates the domain (an array of two values: start and end) that correspond to
   * the scroll value that will be input to a scale for a given element. Takes into
   * account the spread (where on the viewport to start and end) and how much vertical
   * displacement there is when an element is being animated
   *
   * @param  {Number} top         Distance from top of element to top of document
   * @param  {Number} height      Height of element
   * @param  {Object} spread      Where in the viewport do the animations occur
   * @param  {String} attr        CSS attribute being animated
   * @param  {Object} valueChange What the applied changes are at the start and end
   * @return {Array}              Start and end scroll values to animate between
   */
  const genDomain = (top, height, spread, attr, valueChange) => {
    const startSpread = interpretSpread(height, spread.start)
    const finishSpread = interpretSpread(height, spread.finish)
    const verticalChange = interpretVerticalChange(attr, valueChange, height)

    return [(top - startSpread) + verticalChange.from, (top - finishSpread) + verticalChange.to]
  }

  /**
   * Going through all transform and style changes on an element, gets the min and
   * max scroll values to simulate `inview` values to start responding
   *
   * @param  {Object} options.transforms All transform data for the element
   * @param  {Object} options.styles     All style data for the element
   * @return {Array}                     The absolute min and max scroll values of all changes
   */
  const getMaxDomain = ({transforms, styles}) => {
    const domains = Object.values({
      ...omit(transforms, 'initial'),
      ...styles
    }).map(data => data.domain)

    return domains.reduce(([min, max], [first, second]) => {
      return [first < min ? first : min, second > max ? second : max]
    })
  }

  /**
   * Figures out how much inside and outside of viewport to change element values.
   * for example, only need to adjsut an elemnet when bottom of element is at the bottom
   * of the viewport or the center of the element is at the center of the viewport
   *
   * @param  {Number} elementHeight     Height of element
   * @param  {String} [anchorPoint      Part of element to measure from
   * @param  {Number} percentage]       Number from 0-1 (or beyond for offscreen values) to measure to
   * @return {Number}                   Difference from normal element top value to start/end animate
   */
  const interpretSpread = (elementHeight, [anchorPoint, percentage]) => {
    const anchorMap = {
      top: 0,
      center: elementHeight / 2,
      bottom: elementHeight
    }

    return (props.viewportHeight * percentage) - anchorMap[anchorPoint]
  }

  /**
   * Uses the data pertaining to an element to update styles and transforms
   *
   * @param  {Object} data    single data piece from props.elData for an element
   * @return {undefined}
   */
  const updateTransform = data => {
    data.element.style = generateStyle(data.styles)
    data.element.style.transform = generateTransform(data)
  }

  /**
   * Sets value for props.elData, looping over all parelax elements, destructuring and storing necessary
   * values pertaining to that element (most relevant is the scale for interpreting scroll value) to
   * correctly animate it based on scroll position
   *
   * @return {undefined}
   */
  const setupData = () => {
    props.elData = map(els, element => {
      // get computed matrix transform style
      const initialTransform = getInitialTransform(element)
      const {top, height, width} = getDimensions(element)
      const attrCreatorReducer = attrCreator(element, top, height)

      const data = {
        element: element,
        dimensions: {top, height, width},
        transforms: {
          initial: parseMatrix(initialTransform),
          ...attrs.transform.prefixed.reduce(attrCreatorReducer, {})
        },
        styles: {
          ...attrs.css.prefixed.reduce(attrCreatorReducer, {})
        }
      }

      data.maxDomain = getMaxDomain(data)

      updateTransform(data)
      return data
    })
  }

  /**
   * after element, that elements top and height are passed to first function, return the
   * function to run through reduce to generate the data objects for each attribute with the
   * needed scales for each attr
   *
   * @param  {DOM Node} element [description]
   * @param  {Number} top     [description]
   * @param  {Number} height) [description]
   * @return {Object}         [description]
   */
  const attrCreator = (element, top, height) => (a, attr) => {
    const attrValue = element.getAttribute(attr)
    if (!attrValue) return a

    const baseAttr = attr.split('-')[1]
    const {value, spread} = structureElData(baseAttr, attrValue)
    const domain = genDomain(top, height, spread, baseAttr, value)

    return {
      ...a,
      [baseAttr]: {
        value,
        spread,
        domain,
        scales: getInferredAttrs(baseAttr).map((val, i) => {
          return scaleLinear()
            .domain(domain)
            .range([parseFloat(value.from[i]), parseFloat(value.to[i])])
            .clamp(true)
        })
      }
    }
  }

  /**
   * Updates any changed values from a resize event: element top, height, and each
   * attributes' domain values
   *
   * @return {undefined}
   */
  const cacheData = () => {
    props.elData = props.elData.map(data => {
      data.element.style = ''
      const initialTransform = getInitialTransform(data.element)
      const {top, height, width} = getDimensions(data.element)
      const attrCreatorReducer = cacheAttrCreator(data.element, top, height)

      const d = {
        ...data,
        dimensions: {top, height, width},
        transforms: {
          initial: data.transforms.initial,
          ...reduce(omit(data.transforms, 'initial'), attrCreatorReducer, {})
        },
        styles: reduce(data.styles, attrCreatorReducer, {})
      }

      d.maxDomain = getMaxDomain(d)

      updateTransform(d)
      return d
    })
  }

  /**
   * Similar to `attrCreator`, is the reducer function for only updating the scale
   * domains for both transforms and styles
   * NOTE: this returned function to pass to a reducer is designed to be used in
   * reduce from lodash as the collection being reduced over is an object
   *
   * @param  {DOM Node} element   [description]
   * @param  {Number} top         [description]
   * @param  {Number} height)     [description]
   * @return {Object}             [description]
   */
  const cacheAttrCreator = (element, top, height) => (acc, cur, key) => {
    const domain = genDomain(top, height, cur.spread, key, cur.value)
    return {
      ...acc,
      [key]: {
        ...cur,
        domain,
        scales: cur.scales.map(s => s.domain(domain))
      }
    }
  }

  /**
   * Formats inline styles correctly. Currently detecting whether a CSS property uses px or not.
   * If '%' is present, always use that
   *
   * @param  {Number} value CSS property value
   * @param  {String} attr  CSS property
   * @return {String}       Resulting CSS value
   */
  const setStyleDisplay = (value, attr, firstFromVal) => {
    if (firstFromVal.includes && firstFromVal.includes('%')) {
      return `${value}%`
    }

    switch (attr) {
      case 'opacity':
        return `${value}`
      default:
        return `${value}px`
    }
  }

  /**
   * For an attribute that contains multiple values (eg margin), returns the separate values
   * related to the shorthand property. Single values are returned as is but wrapped in an array
   * NOTE: the actual values in the array are irrelevant, just the length of the array that is returned
   *
   * @param  {String} attr  css property obtained from DOM element attribute
   * @return {Array}        separated values for shorthand css property, if necessary
   */
  const getInferredAttrs = attr => {
    switch (attr) {
      case 'margin':
        return ['marginTop', 'marginRight', 'marginBottom', 'marginLeft']
      default:
        return [attr]
    }
  }

  /**
   * Calculates how many pixels vertically a css property will change over
   * the course of the parallax animation
   *
   * @param  {String} attr     CSS property (camelCase)
   * @param  {Object} change   Contains `to` and `from` values
   * @param  {Number} elHeight Elements height
   * @return {Object}          Resolves `to` and `from` values adjusted from `change` param
   */
  const interpretVerticalChange = (attr, change, elHeight) => {
    switch (attr) {
      case 'translateY':
      case 'top':
      case 'bottom':
      case 'fontSize':
        return {
          from: change.from[0],
          to: change.to[0]
        }
      case 'height':
        return {
          from: change.from[0] - elHeight,
          to: change.to[0] - elHeight
        }
      case 'margin':
      case 'padding':
        return {
          from: change.from[0] + change.from[2],
          to: change.to[0] + change.to[2]
        }
      case 'scaleY':
        return {
          from: elHeight * change.from,
          to: elHeight * change.to
        }
      case 'skewY':
        return {
          from: elHeight * (change.from + 1),
          to: elHeight * (change.to + 1)
        }
      default:
        return {
          from: 0,
          to: 0
        }
    }
  }

  /**
   * given a style attribute and the value, handles the different ways those
   * values are interpreted. Values are coerced into an array of numbers, even individual ones
   * for consistency and less special case handling outside in setting range in `setupData`
   *
   * @param  {String} attr  CSS attribute
   * @param  {String} value Space-separated numbers in a string
   * @return {Array}        Set of numbers from value
   */
  const attrParser = (attr, value) => {
    switch (attr) {
      case 'margin':
      case 'rotate3d':
        return value.split(' ').map(attrUnits)
      default:
        return [attrUnits(value)]
    }
  }

  /**
   * Perserves percentage context if '%' is present, otherwise coerces value to a number
   *
   * @param  {String} attrVal     Value from attribute
   * @return {String|Number}      Parsed appropriately
   */
  const attrUnits = attrVal => attrVal.includes('%') ? attrVal : parseFloat(attrVal)

  /**
   * Given the value of an attribute (which as a string can be a number, or include 'px' or '%')
   * When it has '%', we want to preserve it as a string but may need to perform calculations.
   * Provides an interface to perform basic operations, possibility to use currying for added
   * flexibility
   *
   * @param  {String} val Value from an attribute
   * @return {Object}     Simple mathematical operations to modify original val
   */
  const adjustAttrValue = (val) => {
    const isPercentage = val.includes('%')
    const n = parseFloat(val)

    const returnVal = (output) => isPercentage ? `${output}%` : output

    return {
      add: (num) => returnVal(n + num),
      subtract: (num) => returnVal(n - num),
      multiply: (num) => returnVal(n * num),
      divide: (num) => returnVal(n / num),
    }
  }

  const onScroll = () => {
    const {inviewBuffer} = props
    props.currentScroll = window.pageYOffset

    // seeeing an issue with filtering out 'out-of-view' elements because scroll events
    // arent always being triggered enough so they dont hit their top/bottom values
    const inviewEls = props.elData.filter(({maxDomain}) => {
      const [min, max] = maxDomain
      // give elements a buffer of 30px on both ends to make sure they get ther min/max values applied
      return inRange(props.currentScroll, min - inviewBuffer, max + inviewBuffer)
    })

    inviewEls.forEach(updateTransform)
  }

  const onResize = () => {
    props.viewportHeight = getWindowHeight()
    cacheData()
  }

  const createChildren = () => {
    els = document.querySelectorAll(`.js-${prefix}`)
  }

  const init = () => {
    createChildren()
    setupData()
    enable()
  }

  const enable = () => {
    if (props.isEnabled) return

    cbs.onScroll = throttle(onScroll, 50)
    cbs.onResize = debounce(onResize, 150, false)

    window.addEventListener('scroll', onScroll)
    if (!props.isMobileDevice) {
      window.addEventListener('resize', cbs.onResize)
    }

    props.isEnabled = true
  }

  const disable = () => {
    if (!props.isEnabled) return

    window.removeEventListener('scroll', cbs.onScroll)
    window.removeEventListener('resize', cbs.onResize)

    props.isEnabled = false
  }

  return {
    init, enable, disable
  }
}

export default parelax
