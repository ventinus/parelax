import {parelax} from '../utils'

const parallax = () => {
  const props = {
    isEnabled: false,
    plax: parelax()
  }

  const init = () => {
    enable()
  }

  const enable = () => {
    if (props.isEnabled) return

    props.plax.init()

    props.isEnabled = true
  }
  const disable = () => {
    if (!props.isEnabled) return

    props.plax.disable()

    props.isEnabled = false
  }

  return {init, enable, disable}
}

export default parallax
