# `useForm`

Creates a new form state manager. This hook does not cause a rerender.

**Note for using `setState` along with `useForm`**: This library is built upon the fact that only the things that change should rerender. When using `setState` with the form, a state change causes the whole form to rerender. You can reduce this problem by creating components from the things that use the state, or you can use [custom form state](/docs/useForm#defaultstate-optional-issubmitting-false).

`useForm(defaultValues, validator?, validateOnChange = false, validateOnMount = false, defaultState = {isSubmitting: false})`

## Parameters

#### `defaultValues` **(required)**

The initial values of the form. When this parameter changes, the form's default values are updated too. (props/state change)

---

#### `validator` **(optional)**

The validator of this form, which is a function that accepts form values and returns errors for these values in the same object structure. **This function can be async.**

See [validation](/docs/Validation).

---

#### `validateOnChange` **(optional, true)**

True if you want to validate each time a value changes, when false, you have to call `form.validate()` yourself.

---

#### `validateOnMount` **(optional, false)**

True if you want to validate when the form mounts.

---

#### `defaultState` **(optional, {isSubmitting: false})**

The default state of the form. Form state contains variables like isSubmitting and other **custom** form related states.

```jsx
const form = useForm({ name: "John" }); // form.state = { isSumitting: false } by default.

// Usage with a custom isLoading state.
// You can update the state using `form.setState`. Every child form can access and update this state too.
// You must include `isSubmitting: false` when using the built-in inputs (FormInput, FormSelect ...), because they require it.
const form = useForm({ name: "John" }, { isSubmitting: false, isLoading: false });
```

You can set the form state using [`setState`](/docs/FormState#setstatenewstate).

## Returns

A [`FormState`](/docs/FormState) object.
