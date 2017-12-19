import {forEach, map, reduce, omit, throttle, debounce, chunk, toPairs, kebabCase} from 'lodash'
import {scaleLinear} from 'd3-scale'
import {mobileRE} from 'savnac-utils'
import {checkpoint, getWindowHeight} from '.'

// needs:
//  - all checkpoints are defined on a percentage in/out viewport basis
//  - define from and to values (in px/number ie not %) for transitioning property and start and end (0-1) checkpoints
//  - be able to "aniamte" any numeric property beyond just transforms
//  -


// possible issues:

// todos:
//  add ability to animate things on a quadratic curve (ie animate opacity in and out)
//  add any numeric style property as animatable
//  how to calculate rotation in matrix

const parelax = (selector = '.js-parelax') => {
  const props = {
    isEnabled: false,
    elData: [
      // {
      //   element: DOM,
      //   inview: false,
      //   transforms: {
      //     initial: '',
      //     translateX: {
      //       value: 'from,100,to,-100' || '100' (for equal spread in both directions),
      //       spread: 'top,1,center,0.5',
      //       scale: scaleLinear().domain().range().clamp(true)
      //     }
      //   },
      //   dimensions: {
      //     top: 1 // real top value without transforms (or with preexisting transforms)
      //     height: 1
      //   }
      // }
    ],
    ckPoint: checkpoint(),
    currentScroll: window.pageYOffset,
    viewportHeight: getWindowHeight(),
    // amount beyond viewport to start responding to an element "inview"
    adjustedOffset: 0,
    isMobileDevice: mobileRE.test(navigator.userAgent)
  }

  // props.adjustedOffset = props.viewportHeight * 0.1

  const cbs = {}

  const attrs = {
    transform: {
      normal: ['translateY', 'translateX', 'scaleX', 'skewY', 'skewX', 'scaleY', 'rotate', 'rotate3d', 'rotateX', 'rotateY', 'rotateZ']
    },
    css: {
      normal: ['width', 'height', 'padding', 'margin', 'fontSize', 'zIndex', 'opacity']
    },
    all: {}
  }
  attrs.all.normal = [...attrs.transform, ...attrs.css]
  attrs.transform.prefixed = attrs.transform.normal.map(parelaxPrefix)
  attrs.css.prefixed = attrs.css.normal.map(parelaxPrefix)
  attrs.all.prefixed = attrs.all.normal.map(parelaxPrefix)

  let els = []

  function parelaxPrefix(str) {
    return `parelax-${str}`
  }

  // callback for checkpoint to simulate elements scrolled inview at bottom of viewport
  const onElementTopAtBottom = (elementIndex, dir) => {
    props.elData[elementIndex].inview = dir === 'up'
  }

  // callback for checkpoint to simulate elements scrolled inview at top of viewport
  const onElementBottomAtTop = (elementIndex, dir) => {
    props.elData[elementIndex].inview = dir === 'down'
  }

  const onScroll = () => {
    const inviewEls = props.elData.filter(el => el.inview)
    if (inviewEls.length === 0) return
    props.currentScroll = window.pageYOffset
    inviewEls.forEach(updateTransform)
  }

  const generateTransform = (tForms) => {
    const {currentScroll} = props
    const [initialScaleX, initialSkewY, initialSkewX, initialScaleY, initialX, initialY] = tForms.initial
    const {scaleX, skewY, skewX, scaleY, translateX, translateY, rotate, rotateX, rotateY, rotate3d} = tForms

    const scX = !scaleX ? initialScaleX : scaleX.scales[0](currentScroll)
    const skY = !skewY ? initialSkewY : skewY.scales[0](currentScroll)
    const skX = !skewX ? initialSkewX : skewX.scales[0](currentScroll)
    const scY = !scaleY ? initialScaleY : scaleY.scales[0](currentScroll)
    const tX = !translateX ? initialX : translateX.scales[0](currentScroll) + initialX
    const tY = !translateY ? initialY : translateY.scales[0](currentScroll) + initialY

    const r = rotateVal('rotate', rotate)
    const rX = rotateVal('rotateX', rotateX)
    const rY = rotateVal('rotateY', rotateY)
    const r3d = rotateVal('rotate3d', rotate3d)

    return `${matrix([scX, skY, skX, scY, tX, tY])} ${r} ${rX} ${rY} ${r3d}`.trim()
  }

  // creates the string of inline styles from any number of style objects and their scales
  const generateStyle = styles => {
    const {currentScroll} = props

    return Object.keys(styles).reduce((a, k, i) => {
      return `${a}${k}:${styles[k].scales.map(s => setStyleDisplay(s(currentScroll), k)).join(' ')};`
    }, '')
  }

  // formats inline style correctly. with or without 'px'
  const setStyleDisplay = (value, attr) => {
    switch (attr) {
      case 'opacity':
        return value
      default:
        return `${value}px`
    }
  }

  const rotateVal = (name, rotateData) => !rotateData ? '' : `${name}(${rotateData.scales[0](props.currentScroll)}deg)`

  const matrix = (array = [1, 0, 0, 1, 0, 0]) => `matrix(${array.join(',')})`

  // returns values (in pixels) from a matrix string
  const parseMatrix = matrix => {
    return matrix.length === 0 ? [1, 0, 0, 1, 0, 0] : matrix.substring(7).split(',').map(parseFloat)
  }

  // returns top and height values of an element with scroll value taken into account
  const getDimensions = (element) => {
    const {top, height} = element.getBoundingClientRect()
    const realTop = top + props.currentScroll
    return {
      height,
      top: realTop
    }
  }

  const getInitialTransform = element => {
    const computedTransform = window.getComputedStyle(element).transform
    return computedTransform === 'none' ? '' : computedTransform
  }

  const onResize = () => {
    props.viewportHeight = getWindowHeight()
    // props.adjustedOffset = props.viewportHeight * 0.1
    cacheData()
    props.elData.forEach(updateTransform)
  }

  const createChildren = () => {
    els = document.querySelectorAll(selector)
  }

  // given a style attribute and the value, handles the different ways those values are interpreted
  // example multi value attributes get stored as arrays and single values are converted to numbers
  // returning the default single value in an array to maintain method of using values in setting range
  // in setupData
  const attrParser = (attr, value) => {
    switch (attr) {
      case 'margin':
      case 'rotate3d':
        return value.split(' ').map(n => +n)
      default:
        return [+value]
    }
  }

  // takes the string value from the element attribute and given the flexibility of definition,
  // structures it meaningfully
  const structureElData = (attr, t) => {
    // const t = "value=100;spread=top,0.75,bottom,0.25"
    const parsed = t.split(';').reduce((a, c) => {
      const [k, v] = c.split('=')
      return {
        ...a,
        [k]: !v.includes(',') ? +v : chunk(v.split(','), 2).reduce((a, c) => {
          return {
            ...a,
            [c[0]]: attrParser(attr, c[1])
          }
        }, {})
      }
    }, {})

    parsed.spread = parsed.spread || {
      top: 1,
      bottom: 0
    }

    parsed.value = typeof parsed.value === 'object' ? parsed.value : {
      from: parsed.value / 2,
      to: -parsed.value / 2
    }

    return parsed
  }

  // const cacheData = () => {
  //   props.elData = props.elData.map(data => {
  //     data.element.style.transform = ''
  //     const initial = getInitialTransform(data.element)
  //     const [initialX, initialY] = parseMatrix(initial)
  //     const {top, height} = getDimensions(data.element)

  //     return {
  //       ...data,
  //       transforms: {
  //         ...data.transforms,
  //         ...reduce(omit(data.transforms, 'initial'), (a, c, k) => {
  //           return {
  //             ...a,
  //             [k]: {
  //               ...c,
  //               scale: c.scale.domain(scaleDomain(top, height))
  //             }
  //           }
  //         }, {}),
  //         initial: {
  //           x: initialX,
  //           y: initialY
  //         },
  //       },
  //       dimensions: {top, height}
  //     }
  //   })
  // }

  // returns an array of start and end *scroll* values to scale from (anything that starts in the viewport would be zero)
  // accounts for changes that affect element vertically - translateY, scaleY, height, skewY, fontSize, margin, padding
  const genDomain = (top, height, spread, attr, valueChange) => {

    const [start, finish] = toPairs(spread).sort((a, b) => a[1] < b[1])

    const startSpread = interpretSpread(height, start)
    const finishSpread = interpretSpread(height, finish)
    const verticalChange = interpretVerticalChange(attr, valueChange, height)

    return [(top - startSpread) + verticalChange.from, (top - finishSpread) + verticalChange.to]
  }

  // each attribute affects vertical change
  const interpretVerticalChange = (attr, change, elHeight) => {
    switch (attr) {
      case 'translateY':
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
        break;
      default:
        return {
          from: 0,
          to: 0
        }
    }
  }

  const interpretSpread = (elementHeight, [anchorPoint, percentage]) => {
    const anchorMap = {
      top: 0,
      center: elementHeight / 2,
      bottom: elementHeight
    }

    return (props.viewportHeight * percentage) - anchorMap[anchorPoint]
  }

  const updateTransform = data => {
    const tForm = generateTransform(data.transforms)
    const styles = generateStyle(data.styles)

    console.log(styles)
    data.element.style = styles
    data.element.style.transform = tForm
    data.currentTransform = tForm
  }

  // const getInitialStyles = element => {
  //   // remove individual transform attrs as they all live in the `transform` prop.
  //   // convert attr names from camelCase to kebabCase
  //   const cssAttrs = possibleAttrs.filter(attr => {
  //     return !transformAttrs.includes(attr)
  //   }).map(kebabCase).concat(['transform'])
  //   const computedStyle = window.getComputedStyle(element)

  //   //
  //   return cssAttrs.reduce((a, c) => { return {...a, [c]: computedStyle[c]} }, {})
  // }

  const setupData = () => {
    props.elData = map(els, element => {
      // get computed matrix transform style
      const initialTransform = getInitialTransform(element)
      const {top, height} = getDimensions(element)
      const attrCreatorReducer = attrCreator(element, top, height)

      const data = {
        element: element,
        inview: true,
        currentStyles: {},
        dimensions: {top, height},
        transforms: {
          initial: parseMatrix(initialTransform),
          ...attrs.transform.prefixed.reduce(attrCreatorReducer, {})
        },
        styles: {
          ...attrs.css.prefixed.reduce(attrCreatorReducer, {})
        }
      }

      // debugger
      // console.log(data)
      updateTransform(data)
      return data
    })
  }

  // after element, that elements top and height are passed to first function, return the
  // function to run through reduce to generate the data objects for each attribute with the
  // needed scales for each attr
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
        scales: getInferredAttrs(baseAttr).map((val, i) => {
          return scaleLinear()
            .domain(domain)
            .range([value.from[i], value.to[i]])
            .clamp(true)
        })
      }
    }
  }

  const getInferredAttrs = attr => {
    switch (attr) {
      case 'margin':
        return ['marginTop', 'marginRight', 'marginBottom', 'marginLeft']
      default:
        return [attr]
    }
  }

  const init = () => {
    createChildren()
    setupData()
    enable()
  }

  const enable = () => {
    if (props.isEnabled) return

    props.ckPoint.init()

    // forEach(els, (element, i) => {
    //   props.ckPoint.addCheckpoint({
    //     element,
    //     handler(direction) {
    //       onElementTopAtBottom(i, direction)
    //     },
    //     // offset: 1
    //     offset: 2
    //   })

    //   props.ckPoint.addCheckpoint({
    //     element,
    //     handler(direction) {
    //       onElementBottomAtTop(i, direction)
    //     },
    //     trigger: 'bottom',
    //     // offset: 0
    //     offset: -2
    //   })
    // })

    cbs.onScroll = throttle(onScroll, 50)
    cbs.onResize = debounce(onResize, 150, false)

    window.addEventListener('scroll', onScroll)
    if (!props.isMobileDevice) {
      // window.addEventListener('resize', cbs.onResize)
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
