// --- DYNAMIC UI COMPONENT LIBRARY ---
import {EventEmitter} from "./utils.js";

export class Component extends EventEmitter {
    constructor(tag, {id, className, ...props} = {}) {
        super();
        this.element = document.createElement(tag);
        if (id) this.element.id = id;
        if (className) this.element.className = className;
        Object.entries(props).forEach(([key, value]) => this.element[key] = value);
    }

    add(...children) {
        children.forEach(child => this.element.appendChild(child.element || child));
        return this;
    }

    setContent(content) {
        this.element.innerHTML = '';
        if (content) {
            if (typeof content === 'string') this.element.innerHTML = content;
            else this.add(content);
        }
        return this;
    }

    mount(parent) {
        (parent.element || parent).appendChild(this.element);
        return this;
    }

    show(visible = true) {
        this.element.classList.toggle('hidden', !visible);
        return this;
    }

    destroy() {
        this.element.remove();
    }
}

export class Button extends Component {
    constructor(props) {
        super('button', props);
        if (props.onClick) this.element.addEventListener('click', props.onClick);
    }

    setEnabled(enabled) {
        this.element.disabled = !enabled;
    }
}
