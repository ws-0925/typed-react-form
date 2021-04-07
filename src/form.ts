export type ListenerCallback = () => void;
export type ListenerMap = { [T in string]?: ListenerCallback };
export type Validator<T, Error> = (values: T) => ErrorType<T, Error> | Promise<ErrorType<T, Error>>;

export type ChildFormMap<T, State, Error extends string> = {
    [Key in keyof T]?: ChildFormState<T, Key, State, Error>;
};

export type DirtyMap<T> = {
    [Key in keyof T]?: boolean;
};

export type ErrorType<T, Error> = Error | (T extends {} ? ErrorMap<NonNullable<T>, Error> : never);

export type ErrorMap<T, Error> = {
    [Key in keyof T]?: ErrorType<T[Key], Error>;
};

export type DefaultError = string;
export type DefaultState = { isSubmitting: boolean };

function memberCopy<T>(value: T): T {
    if (Array.isArray(value)) {
        return [...value] as any;
    } else if (typeof value === "object") {
        return { ...value };
    } else {
        throw new Error("Can only memberCopy() arrays and objects.");
    }
}

function addDistinct<T extends any[]>(arr1: T, arr2: T) {
    for (let i = 0; i < arr2.length; i++) {
        if (!arr1.includes(arr2[i])) arr1.push(arr2[i]);
    }
}

/**
 * Compares 2 objects that only contain primitive fields (no object fields)
 * @returns true when different, false when 'equal', undefined when an object field was found.
 */
function comparePrimitiveObject<T>(a: T, b: T): boolean | undefined {
    // Compare null and undefined
    if (!a || !b) return a === b;
    let ak = Object.keys(a),
        bk = Object.keys(b);
    let lk = ak.length > bk.length ? ak : bk;
    for (let i = 0; i < lk.length; i++) {
        let k = lk[i];
        let av = a[k],
            bv = b[k];
        if ((typeof av === "object" && av !== null) || (typeof bv === "object" && bv !== null)) return undefined;
        if (av !== bv) return true;
    }
    return false;
}

export class FormState<T, State = DefaultState, Error extends string = DefaultError> {
    /**
     * The id of this form, for debugging purposes.
     */
    public readonly formId = ++FormState.formCounter;

    /**
     * The form's validator.
     */
    public validator?: Validator<T, Error>;

    /**
     * Should the form validate on each value change?
     */
    public validateOnChange: boolean;
    public validateOnMount: boolean;

    /**
     * The values on this form. Use setValues() to set these.
     */
    public readonly values: T;

    /**
     * The default values on this form. Use setDefaultValues(...) to set these.
     */
    public readonly defaultValues: T;

    /**
     * The dictionary that maps object fields to child forms.
     */
    public readonly childMap: ChildFormMap<T, State, Error> = {};

    /**
     * The dictionary that contains dirty states for each field.
     */
    public readonly dirtyMap: DirtyMap<T> = {};

    /**
     * The dictionary that contains errors for each field.
     */
    public readonly errorMap: ErrorMap<T, Error> = {};

    private _state: State;
    private listeners: { [Key in keyof T]?: ListenerMap } = {};
    private anyListeners: ListenerMap = {};
    private counter = 0;
    private static formCounter = 0;

    public constructor(
        values: T,
        defaultValues: T,
        defaultState: State,
        validator: Validator<T, Error> | undefined,
        validateOnMount: boolean,
        validateOnChange: boolean
    ) {
        this.values = memberCopy(values);
        this.defaultValues = memberCopy(defaultValues);
        this._state = memberCopy(defaultState);
        this.validator = validator;
        this.validateOnMount = validateOnMount;
        this.validateOnChange = validateOnChange;
    }

    /**
     * Gets the state of the current form.
     */
    public get state() {
        return this._state;
    }

    /**
     * Is this form modified?
     */
    public get dirty() {
        return Object.keys(this.dirtyMap).some((e) => this.dirtyMap[e]);
    }

    /**
     * Does this form contain any error?
     */
    public get error() {
        return Object.keys(this.errorMap).some((e) => this.errorMap[e]);
    }

    /**
     * Sets a value the advanced way.
     * @param key The field to set.
     * @param value The value to set in the field.
     * @param dirty Is this field dirty? Leave undefined to not set any dirty value. (can always be overridden by child forms)
     * @param validate Should the form validate after value set? Overrides `validateOnChange`.
     * @param isDefault Is this the default value for the said field?
     * @param notifyChild Should this form notify any child form about the change?
     * @param notifyParent Should this form notify any parent form about the change?
     * @param setValuesWasUsed Fire all `anyListeners` after field is set? You should not touch this. (will be false for bulk sets, they will call fireAnyListeners() after every field is set)
     */
    public setValueInternal<Key extends keyof T>(
        key: Key,
        value: T[Key] | undefined,
        dirty: boolean,
        validate?: boolean,
        isDefault: boolean = false,
        notifyChild: boolean = true,
        notifyParent: boolean = true,
        fireAny: boolean = true
    ) {
        let valueMap = isDefault ? this.defaultValues : this.values;
        if (value === undefined) {
            if (Array.isArray(valueMap)) valueMap.splice(key as number, 1);
            else delete valueMap[key];
        } else {
            valueMap[key] = value;
        }

        this.dirtyMap[key] = dirty;

        if (notifyChild) {
            let child = this.childMap[key];
            if (child && value !== undefined && value !== null) {
                child.setValues(value!, validate, isDefault, true, false);
                this.dirtyMap[key] = child.dirty;
            }
        }

        this.fireListeners(key);
        if (fireAny) this.fireAnyListeners(); // Will be false when using setValues, he will call fireAnyListeners and notifyParentValues itself

        if (notifyParent && this instanceof ChildFormState) {
            this.parent.setValueInternal(
                this.name,
                Object.keys(valueMap).length > 0 ? memberCopy(valueMap) : undefined,
                this.dirty,
                validate,
                isDefault,
                false,
                true,
                true
            );
        }

        if (validate ?? (this.validateOnChange && this.validator)) this.validate();
    }

    /**
     * Set a value on this form.
     * @param key The field to set.
     * @param value The field's new value.
     * @param validate Should the form validate?
     * @param isDefault Is this the default value?
     * @param notifyChild Should this form notify the child form about this change?
     * @param notifyParent Should this form notify the parent form about this change?
     * @param setValuesWasUsed Fire all `anyListeners` after field is set? You should not touch this. (will be false for bulk sets, they will call fireAnyListeners() after every field is set)
     */
    public setValue<Key extends keyof T>(
        key: Key,
        value: T[Key] | undefined,
        validate?: boolean,
        isDefault: boolean = false,
        notifyChild: boolean = true,
        notifyParent: boolean = true,
        fireAny: boolean = true
    ) {
        // value can contain the default value or normal value. (Determined by isDefault)
        if (typeof value === "object" && value !== null) {
            let dirty: boolean | undefined = false;
            if (value instanceof Date) {
                // Compare date objects
                dirty = value?.getTime() !== (isDefault ? this.values[key] : (this.defaultValues[key] as any))?.getTime();
            } else if (fireAny) {
                // Compare primitive objects (objects containing only primitive fields), but only is setValues was not used (dirty value will be determined by child forms)
                dirty = comparePrimitiveObject(value, isDefault ? this.values[key] : this.defaultValues[key]); // Is switched intentionally
                if (dirty === undefined) {
                    console.warn(
                        "Do not use setValue for object in object fields, use setValueInternal instead (dirty value can not be determined), ",
                        key,
                        value
                    );
                    dirty = true;
                }
            }

            this.setValueInternal(key, value, dirty, validate, isDefault, notifyChild, notifyParent, fireAny);
        } else {
            // Compare value and existing value/defaultValue which determines dirty
            let dirty = isDefault ? value !== this.values[key] : value !== this.defaultValues[key];

            // Do not set if already set
            if (((isDefault && this.defaultValues[key] === value) || (!isDefault && this.values[key] === value)) && this.dirtyMap[key] === dirty) {
                return;
            }

            this.setValueInternal(key, value, dirty, validate, isDefault, notifyChild, notifyParent, fireAny);
        }
    }

    /**
     * Set multiple values OR default values on this form.
     * @param values The new values to set on this form.
     * @param validate Validate? Overrides `validateOnChange`.
     * @param isDefault Are these values the default values for this form? This function only updates values or defaultValues, not both! To set both, use `form.setDefaultValues()`.
     * @param notifyChild Should this form notify the child form about this change?
     * @param notifyParent Should this form notify the parent form about this change?
     */
    public setValues(values: Partial<T>, validate?: boolean, isDefault: boolean = false, notifyChild: boolean = true, notifyParent: boolean = true) {
        let keys = Object.keys(isDefault ? this.defaultValues : this.values);
        addDistinct(keys, Object.keys(values));

        // Traverse backwards, so when removing array items, the whole array gets shifted in the right direction
        for (let i = keys.length - 1; i >= 0; i--) {
            let key = keys[i] as keyof T;
            this.setValue(
                key,
                values[key],
                false, // Will validate after all values are copied
                isDefault,
                notifyChild,
                false, // Will call updateParentValues by itself after all values are copied, see 3 lines down
                false // Will call fireAnyListener by itself after all values are copied, see 3 lines down
            );
        }
        this.fireAnyListeners();
        if (notifyParent && this instanceof ChildFormState) {
            let values = isDefault ? memberCopy(this.defaultValues) : memberCopy(this.values);
            this.parent.setValueInternal(
                this.name,
                Object.keys(values).length > 0 ? values : undefined,
                this.dirty,
                validate,
                isDefault,
                false,
                true,
                true
            );
        }

        if (validate ?? (this.validateOnChange && this.validator)) this.validate();
    }

    /**
     * Set both values and default values for this form. If you only want to set values, use setValues(...). If you only want to set default values, use `setValues(...,...,true)`.
     * @param values The new default values to set on this form.
     * @param validate Validate? Overrides `validateOnChange`.
     * @param notifyChild Should this form notify the child form about this change?
     * @param notifyParent Should this form notify the parent form about this change?
     */
    public setDefaultValues(values: Partial<T>, validate: boolean = true, notifyChild: boolean = true, notifyParent: boolean = true) {
        this.setValues(values, false, true, notifyChild, notifyParent);
        this.setValues(values, validate, false, notifyChild, notifyParent);
    }

    /**
     * Force validation on this form. Required when `validateOnChange` is disabled. **This function works with both asynchronous and synchronous validators.**
     * @returns true if the form is valid.
     */
    public async validate() {
        if (!this.validator) return true;
        let r = this.validator(this.values);
        if (r instanceof Promise) r = await r;
        this.setErrors(r);
        return !this.error;
    }

    /**
     * Force validation on this form. Required when `validateOnChange` is disabled. **This only works if you have a synchronous validator set (not async).**
     * @returns true if the form is valid.
     */
    public validateSync() {
        if (!this.validator) return true;
        let r = this.validator(this.values);
        if (r instanceof Promise)
            throw new Error("validateSync() was called on a form with an asynchronous validator set, please use `await form.validate()` instead.");
        this.setErrors(r);
        return !this.error;
    }

    /**
     * Sets an error on this form
     * @param key The field to set an error on.
     * @param error The error.
     * @param notifyChild Should this form notify the child form about this change?
     * @param notifyParent Should this form notify the parent form about this change?
     */
    public setError<Key extends keyof T>(
        key: Key,
        error: ErrorType<NonNullable<T[Key]>, Error> | undefined,
        notifyChild: boolean = true,
        notifyParent: boolean = true,
        fireAny: boolean = true
    ) {
        if (typeof error !== "object" && this.errorMap[key] === error) return false;

        if (!error) delete this.errorMap[key];
        else this.errorMap[key] = error;

        if (notifyChild && this.childMap[key]) {
            let changed = this.childMap[key]!.setErrors(error ?? ({} as any), true, false);
            if (!changed && error !== undefined) return false;
        }

        this.fireListeners(key);
        if (fireAny) this.fireAnyListeners(); // When setValuesWasUsed, it will call fireAnyListener itself when all values were set

        if (notifyParent && this instanceof ChildFormState) {
            this.parent.setError(this.name, this.error ? memberCopy(this.errorMap) : undefined, false, true);
        }
        return true;
    }

    /**
     * Sets all the errors on this form.
     * @param errors The new errors for this form. Use {} to clear errors. **The format of this error object must follow the same structure of the values object, but each value is replaced by its error.**
     * @param notifyChild Should this form notify the child form about this change?
     * @param notifyParent Should this form notify the parent form about this change?
     */
    public setErrors(errors: ErrorType<T, Error>, notifyChild: boolean = true, notifyParent: boolean = true) {
        let keys = Object.keys(this.errorMap);

        if (typeof errors === "string") {
            if (notifyParent && this instanceof ChildFormState) {
                this.parent.setError(this.name, errors, false, true);
            }
            errors = {} as any;
        } else {
            addDistinct(keys, Object.keys(errors));
        }

        let changed = false;
        for (let i = keys.length; i >= 0; i--) {
            let key = keys[i] as keyof T;
            if (
                this.setError(
                    key,
                    (errors as ErrorMap<T, Error>)[key] as ErrorType<NonNullable<T[keyof T]>, Error>,
                    notifyChild,
                    false, // Will call this.parent.setError by itself after all values have been copied, see 3 lines down
                    false // Will call fireAnyListener by itself after all values have been copied, see 3 lines down
                )
            )
                changed = true;
        }
        if (!changed) return false;

        this.fireAnyListeners();
        if (notifyParent && this instanceof ChildFormState) {
            this.parent.setError(this.name, this.error ? (memberCopy(this.errorMap) as any) : undefined, false, true);
        }
        return true;
    }

    /**
     * Reset this form's values to the default values.
     * @param notifyChild Should this form notify the child form about this change?
     * @param notifyParent Should this form notify the parent form about this change?
     */
    public resetAll(validate?: boolean, notifyChild: boolean = true, notifyParent: boolean = true) {
        this.setValues(this.defaultValues, validate ?? true, false, notifyChild, notifyParent);
    }

    /**
     * Reset a form's field to its default value.
     * @param key The field to reset.
     * @param notifyChild Should this form notify the child form about this change?
     * @param notifyParent Should this form notify the parent form about this change?
     */
    public reset(key: keyof T, validate?: boolean, notifyChild: boolean = true, notifyParent: boolean = true) {
        this.setValue(key, this.defaultValues[key], validate ?? true, false, notifyChild, notifyParent);
    }

    /**
     * Sets the state for this form, and also on child and parent forms by default.
     * @param newState The new form state.
     * @param notifyChild Set the state on the child too?
     * @param notifyParent Set the state on the parent too?
     */
    public setState(newState: State, notifyChild: boolean = true, notifyParent: boolean = true) {
        this._state = newState;

        let c = Object.keys(this.values) as (keyof T)[];
        if (notifyChild) c.forEach((e) => this.childMap[e]?.setState(newState, true, false));

        c.forEach((e) => this.fireListeners(e));
        this.fireAnyListeners();

        if (notifyParent && this instanceof ChildFormState) {
            this.parent.setState(memberCopy(this.state), false, true);
        }
    }

    /**
     * Creates a submit handler to pass to your `<form onSubmit={...}>`. The function executes the passed handler only if the form validates correctly.
     * @param handler The handler to execute when this form contains no errors.
     */
    public handleSubmit(handler: (form: FormState<T, State, Error>) => void | Promise<void>) {
        async function handle(this: FormState<T, State, Error>, ev: React.FormEvent<HTMLFormElement>) {
            ev.preventDefault();

            // Show helpful warning when using buttons to submit
            if (process.env.NODE_ENV === "development") {
                let buttons = Array.from((ev.target as HTMLFormElement).querySelectorAll("button"));
                let noTypeButton = buttons.find((e) => !("type" in e.attributes));
                if (noTypeButton) {
                    console.error(
                        `The submitted form contains a button without a type attribute. Please populate every button in your form with either type="button" or type="submit".`,
                        noTypeButton
                    );
                }
            }

            if (!(await this.validate())) return;
            this.setState({ ...this.state, isSubmitting: true });
            await handler(this);
            this.setState({ ...this.state, isSubmitting: false });
        }
        return handle.bind(this);
    }

    /**
     * Listen for changes on a field, will trigger when value, defaultValue, dirty and error changes for a field. Make sure you pass its return value back to `ignore()` after you are done listening.
     * @param key The field to listen to.
     * @param listener Change callback.
     */
    public listen(key: keyof T, listener: ListenerCallback): string {
        if (!this.listeners) this.listeners = {};
        let setters = this.listeners[key];
        if (!setters) {
            setters = {};
            this.listeners[key] = setters;
        }
        let id = "" + this.counter++;
        setters[id] = listener;
        return id;
    }

    /**
     * Listen for any change on this form. Make sure you pass its return value back to `ignoreAny()` after you are done listening.
     * @param listener Change callback.
     */
    public listenAny(listener: ListenerCallback) {
        if (!this.anyListeners) this.anyListeners = {};
        let id = "" + this.counter++;
        this.anyListeners[id] = listener;
        return id;
    }

    /**
     * Ignore changes on a field.
     * @param key The field to ignore.
     * @param id The callback to ignore.
     */
    public ignore(key: keyof T, id: string) {
        if (!this.listeners) return;
        let setters = this.listeners[key];
        if (!setters) {
            console.warn("Ignore was called for no reason", key, id);
            return;
        }
        delete setters[id];
    }

    /**
     * Ignore changes on this form.
     * @param id The callback to ignore.
     */
    public ignoreAny(id: string) {
        if (!this.anyListeners) return;
        delete this.anyListeners[id];
    }

    protected fireListeners(key: keyof T) {
        let a = this.listeners[key];
        if (a) {
            let l = Object.keys(a!);
            l.forEach((e) => a![e]!());
        }
    }

    protected fireAnyListeners() {
        let al = Object.keys(this.anyListeners);
        al.forEach((e) => this.anyListeners[e]!());
    }
}

export class ChildFormState<Parent, Key extends keyof Parent, ParentState, ParentError extends string> extends FormState<
    NonNullable<Parent[Key]>,
    ParentState,
    ParentError
> {
    public name: Key;
    public readonly parent: FormState<Parent, ParentState, ParentError>;

    public constructor(parent: FormState<Parent, ParentState, ParentError>, name: Key) {
        super(
            parent.values[name] ?? ({} as any),
            parent.defaultValues[name] ?? ({} as any),
            parent.state,
            undefined,
            parent.validateOnMount,
            parent.validateOnChange
        );
        this.parent = parent;
        this.name = name;
    }
}
