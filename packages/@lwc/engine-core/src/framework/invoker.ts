/*
 * Copyright (c) 2018, salesforce.com, inc.
 * All rights reserved.
 * SPDX-License-Identifier: MIT
 * For full license text, see the LICENSE file in the repo root or https://opensource.org/licenses/MIT
 */
import { assert, isFunction, isUndefined } from '@lwc/shared';

import { evaluateTemplate, Template, setVMBeingRendered, getVMBeingRendered, TemplateFactory } from './template';
import { VM, runWithBoundaryProtection } from './vm';
import { ComponentConstructor, ComponentInterface } from './component';
import { startMeasure, endMeasure } from './performance-timing';

import { addErrorComponentStack } from '../shared/error';

export let isInvokingRender: boolean = false;

export let vmBeingConstructed: VM | null = null;
export function isBeingConstructed(vm: VM): boolean {
    return vmBeingConstructed === vm;
}

let vmInvokingRenderedCallback: VM | null = null;
export function isInvokingRenderedCallback(vm: VM): boolean {
    return vmInvokingRenderedCallback === vm;
}

const noop = () => void 0;

export function invokeComponentCallback(vm: VM, fn: (...args: any[]) => any, args?: any[]): any {
    const { component, callHook, owner } = vm;
    let result;
    runWithBoundaryProtection(
        vm,
        owner,
        noop,
        () => {
            // job
            result = callHook(component, fn, args);
        },
        noop
    );
    return result;
}

export function invokeComponentConstructor(vm: VM, Ctor: ComponentConstructor) {
    const vmBeingConstructedInception = vmBeingConstructed;
    let error;
    if (process.env.NODE_ENV !== 'production') {
        startMeasure('constructor', vm);
    }
    vmBeingConstructed = vm;
    /**
     * Constructors don't need to be wrapped with a boundary because for root elements
     * it should throw, while elements from template are already wrapped by a boundary
     * associated to the diffing algo.
     */
    try {
        // job
        const result = new Ctor();

        // Check indirectly if the constructor result is an instance of LightningElement. Using
        // the "instanceof" operator would not work here since Locker Service provides its own
        // implementation of LightningElement, so we indirectly check if the base constructor is
        // invoked by accessing the component on the vm.
        if (vmBeingConstructed.component !== result) {
            throw new TypeError(
                'Invalid component constructor, the class should extend LightningElement.'
            );
        }
    } catch (e) {
        error = Object(e);
    } finally {
        if (process.env.NODE_ENV !== 'production') {
            endMeasure('constructor', vm);
        }
        vmBeingConstructed = vmBeingConstructedInception;
        if (!isUndefined(error)) {
            addErrorComponentStack(vm, error);
            // re-throwing the original error annotated after restoring the context
            throw error; // eslint-disable-line no-unsafe-finally
        }
    }
}

export function invokeComponentRenderMethod(vm: VM): Template | null {
    const {
        def: { render },
        callHook,
        component,
        owner,
    } = vm;

    const isRenderBeingInvokedInception = isInvokingRender;
    const vmBeingRenderedInception = getVMBeingRendered();
    let templateFactory: TemplateFactory;

    runWithBoundaryProtection(
        vm,
        owner,
        () => {
            // pre
            isInvokingRender = true;
            setVMBeingRendered(vm);
        },
        () => {
            // job
            vm.tro.observe(() => {
                templateFactory = callHook(component, render);
            });
        },
        () => {
            // post
            isInvokingRender = isRenderBeingInvokedInception;
            setVMBeingRendered(vmBeingRenderedInception);
        }
    );

    return evaluateTemplate(vm, templateFactory!);
}

export function invokeComponentRenderedCallback(vm: VM): void {
    const {
        def: { renderedCallback },
        component,
        callHook,
        owner,
    } = vm;
    if (!isUndefined(renderedCallback)) {
        const vmInvokingRenderedCallbackInception = vmInvokingRenderedCallback;
        runWithBoundaryProtection(
            vm,
            owner,
            () => {
                vmInvokingRenderedCallback = vm;
                // pre
                if (process.env.NODE_ENV !== 'production') {
                    startMeasure('renderedCallback', vm);
                }
            },
            () => {
                // job
                callHook(component, renderedCallback!);
            },
            () => {
                // post
                if (process.env.NODE_ENV !== 'production') {
                    endMeasure('renderedCallback', vm);
                }
                vmInvokingRenderedCallback = vmInvokingRenderedCallbackInception;
            }
        );
    }
}

export function invokeEventListener(
    vm: VM,
    fn: EventListener,
    thisValue: undefined | ComponentInterface,
    event: Event
) {
    const { callHook, owner } = vm;
    runWithBoundaryProtection(
        vm,
        owner,
        noop,
        () => {
            // job
            if (process.env.NODE_ENV !== 'production') {
                assert.isTrue(
                    isFunction(fn),
                    `Invalid event handler for event '${event.type}' on ${vm}.`
                );
            }
            callHook(thisValue, fn, [event]);
        },
        noop
    );
}
